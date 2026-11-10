import { describe, expect, it } from "vitest";
import { callModelHedged, defaultModelDeps, orderModels, type ModelDeps } from "./model";
import { BROWSING_FIRST, PICKABLE, browsingDeps, describeChoice, modelDepsFor, parseChoice, preferFirst, roundsFor } from "./models";
import { collect, scripted } from "./fakes";

const base: ModelDeps = { ...defaultModelDeps, now: () => 1000 };
const ids = (d: ModelDeps) => d.models.map((m) => `${m.provider}:${m.model}`);

describe("every pickable model is really on the server roster", () => {
  it.each(PICKABLE.map((p) => [`${p.provider}:${p.model}`, p] as const))("%s", (_n, p) => {
    expect(defaultModelDeps.models.some((m) => m.provider === p.provider && m.model === p.model)).toBe(true);
  });
});

describe("preferFirst", () => {
  const m = [{ provider: "groq", model: "a" }, { provider: "groq", model: "b" }, { provider: "nvidia", model: "c" }] as const;
  it("moves wanted ids to the front in the order asked, rest keep their order", () => {
    expect(preferFirst(m, ["c", "a"]).map((x) => x.model)).toEqual(["c", "a", "b"]);
  });
  it("ignores ids that are not on the roster", () => expect(preferFirst(m, ["zzz"]).map((x) => x.model)).toEqual(["a", "b", "c"]));
  it("does not duplicate when an id repeats", () => expect(preferFirst(m, ["b", "b"]).map((x) => x.model)).toEqual(["b", "a", "c"]));
});

describe("modelDepsFor", () => {
  it("standard keeps the roster order and rotation", () => {
    const d = modelDepsFor(base, { level: "standard" });
    expect(ids(d)).toEqual(ids(base));
    expect(d.rotate).toBeUndefined();
  });
  it.each([
    ["light", "groq:openai/gpt-oss-20b", 2],
    ["high", "groq:openai/gpt-oss-120b", 2],
    ["ultra", "bluesminds:nvidia/nemotron-3-ultra-550b-a55b", 3],
  ] as const)("%s leads with %s and races %i", (level, first, hedge) => {
    const d = modelDepsFor(base, { level });
    expect(ids(d)[0]).toBe(first);
    expect(d.hedge).toBe(hedge);
    expect(d.rotate).toBe(false);
  });
  it("never drops a model (the blind check needs a second family)", () => {
    for (const level of ["light", "standard", "high", "ultra"] as const) expect(ids(modelDepsFor(base, { level })).sort()).toEqual(ids(base).sort());
  });
  it("a pinned roster model goes first, alone in the race, and stays first on every round", () => {
    const pin = { provider: "openrouter", model: "google/gemma-4-31b-it:free" } as const;
    const d = modelDepsFor(base, { level: "ultra", pin });
    expect(ids(d)[0]).toBe("openrouter:google/gemma-4-31b-it:free");
    expect(d.hedge).toBe(1);
    expect(ids(d)).toHaveLength(base.models.length);
    for (const round of [0, 1, 5]) expect(orderModels(d.models, d.rotate === false ? 0 : round, 1000, new Map())[0]).toEqual(pin);
  });
  it("ignores a pin that is not on the roster, so a forged request reaches no new model", () => {
    const d = modelDepsFor(base, { level: "high", pin: { provider: "groq", model: "evil/model" } });
    expect(ids(d)[0]).toBe("groq:openai/gpt-oss-120b");
    expect(ids(d)).not.toContain("groq:evil/model");
  });
});

describe("browsingDeps (a browsing step is waited for)", () => {
  it("every model it prefers is on the server roster", () => {
    for (const id of BROWSING_FIRST) expect(defaultModelDeps.models.some((m) => m.model === id)).toBe(true);
  });
  it("puts the fast, reliable models first, in a fixed order, and keeps the whole roster", () => {
    const d = browsingDeps(base);
    expect(d.models.slice(0, 3).map((m) => m.model)).toEqual([...BROWSING_FIRST]);
    expect(ids(d).sort()).toEqual(ids(base).sort());
    expect(d.rotate).toBe(false);
  });
  it("keeps an order the person chose on purpose (a pinned model, High, Ultra)", () => {
    const pinned = modelDepsFor(base, { level: "light", pin: { provider: "openrouter", model: "google/gemma-4-31b-it:free" } });
    expect(browsingDeps(pinned)).toBe(pinned);
    const ultra = modelDepsFor(base, { level: "ultra" });
    expect(browsingDeps(ultra)).toBe(ultra);
  });
});

describe("a reply the caller refuses", () => {
  const two: ModelDeps = { open: undefined as never, now: () => 1, rotate: false, models: [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "groq", model: "openai/gpt-oss-20b" }] };
  const isJson = (t: string) => t.trim().startsWith("{");
  it("moves to the next model in the same call instead of failing", async () => {
    const s = scripted(["I will just click it", '{"a":1}']);
    const { ret } = await collect(callModelHedged("main", [{ role: "user", content: "x" }], { ...two, open: s.open }, { accept: isJson }));
    expect(ret).toMatchObject({ ok: true, text: '{"a":1}' });
    expect(s.calls()).toBe(2);
  });
  it("hands back the refused reply when every model gave one, so the caller can say what was wrong", async () => {
    const s = scripted(["prose one", "prose two"]);
    const { ret } = await collect(callModelHedged("main", [{ role: "user", content: "x" }], { ...two, open: s.open }, { accept: isJson }));
    expect(ret).toMatchObject({ ok: false, rejected: "prose two" });
  });
  it("does not claim a refused reply when no model answered at all", async () => {
    const open = (async () => ({ ok: false as const, degraded: true as const, reason: "http 500" })) as never;
    const { ret } = await collect(callModelHedged("main", [{ role: "user", content: "x" }], { ...two, open }, { accept: isJson }));
    expect(ret).toMatchObject({ ok: false });
    expect(ret).not.toHaveProperty("rejected");
  });
});

describe("hedged race with a fixed order", () => {
  it("racers start on different models even when the order does not rotate", async () => {
    const seen: string[] = [];
    const open = (async (provider: string, model: string) => {
      seen.push(`${provider}:${model}`);
      return { ok: false as const, degraded: true as const, reason: "http 500" };
    }) as never;
    const deps: ModelDeps = { open, now: () => 1, hedge: 2, rotate: false, models: [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "groq", model: "openai/gpt-oss-20b" }] };
    await collect(callModelHedged("main", [{ role: "user", content: "x" }], deps));
    expect(seen.slice(0, 2).sort()).toEqual(["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
  });
  it("still answers when one racer works", async () => {
    const s = scripted(['{"ok":1}']);
    const deps: ModelDeps = { open: s.open, now: () => 1, hedge: 2, rotate: false, models: [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "groq", model: "openai/gpt-oss-20b" }] };
    const { ret } = await collect(callModelHedged("main", [{ role: "user", content: "x" }], deps));
    expect(ret).toMatchObject({ ok: true, text: '{"ok":1}' });
  });
});

describe("roundsFor / describeChoice / parseChoice", () => {
  it.each([[{ level: "light" }, 4], [{ level: "standard" }, 6], [{ level: "high" }, 6], [{ level: "ultra" }, 8], [{ level: "ultra", pin: { provider: "groq", model: "x" } }, 6]] as const)("%j -> %i rounds", (c, n) => {
    expect(roundsFor(c as never)).toBe(n);
  });
  it("names the lead model", () => {
    expect(describeChoice({ level: "high" })).toMatchObject({ pill: "High", title: "GPT-OSS 120B" });
    expect(describeChoice({ level: "high", pin: { provider: "groq", model: "openai/gpt-oss-20b" } }).pill).toBe("GPT-OSS 20B");
  });
  it.each([
    [null, { level: "standard" }],
    ["high", { level: "standard" }],
    [{ level: "nope" }, { level: "standard" }],
    [{ level: "ultra" }, { level: "ultra" }],
    [{ level: "high", pin: { provider: "groq", model: "openai/gpt-oss-20b" } }, { level: "high", pin: { provider: "groq", model: "openai/gpt-oss-20b" } }],
    [{ level: "high", pin: { provider: "evil", model: "x" } }, { level: "high" }],
    [{ level: "high", pin: { provider: "groq", model: "x".repeat(200) } }, { level: "high" }],
  ])("parseChoice(%j)", (input, want) => expect(parseChoice(input)).toEqual(want));
});
