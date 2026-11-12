import { beforeEach, describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import type { CEvent } from "./events";
import { benchedLong, callModel, cooldownFor, defaultModelDeps, demote, orderModels, resetCooldowns, shortestWait, tokenBudget, type ModelDeps, type ModelRef } from "./model";
import { isAllowedModel } from "@/lib/integrations/chat";

const M: ModelRef[] = [
  { provider: "groq", model: "g/a" }, { provider: "groq", model: "g/b" },
  { provider: "openrouter", model: "o/c:free" }, { provider: "openrouter", model: "o/d:free" },
];
beforeEach(resetCooldowns);

describe("orderModels", () => {
  it("round-robins the whole roster so successive steps start on different models", () => {
    expect(orderModels(M, 0, 0, new Map()).map((m) => m.model)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 1, 0, new Map()).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free", "g/a"]);
    expect(orderModels(M, 4, 0, new Map()).map((m) => m.model)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
  });
  it("skips models still cooling down (keyed per provider:model), but never returns an empty list", () => {
    expect(orderModels(M, 0, 100, new Map([["groq:g/a", 500]])).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 0, 100, new Map(M.map((m) => [`${m.provider}:${m.model}`, 500]))).length).toBe(4);
  });
  it("a cooldown on one provider does not cool the same model id elsewhere", () => {
    const M2: ModelRef[] = [{ provider: "groq", model: "x/y" }, { provider: "tokenrouter", model: "x/y" }];
    expect(orderModels(M2, 0, 100, new Map([["groq:x/y", 500]])).map((m) => m.provider)).toEqual(["tokenrouter"]);
  });
});

const sse = (...c: object[]) => c.map((x) => `data: ${JSON.stringify({ choices: [{ delta: x }] })}\n\n`).join("") + "data: [DONE]\n\n";
const stream = (t: string): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } });
const ok = (provider: "groq" | "openrouter", model: string, t: string) => ({ ok: true as const, data: { provider, model, body: stream(t) } });
const bad = (reason: string) => ({ ok: false as const, degraded: true as const, reason });
const deps = (open: unknown): ModelDeps => ({ open: open as typeof openChat, models: M, now: () => 1000 });

async function drain(g: AsyncGenerator<CEvent, unknown>) {
  const ev: CEvent[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { ev, ret: n.value };
    ev.push(n.value);
  }
}

describe("callModel", () => {
  it("streams reasoning as events and returns the content", async () => {
    const { ev, ret } = await drain(callModel("main", [], deps(async (p: "groq", m: string) => ok(p, m, sse({ reasoning: "hm" }, { content: '{"a":1}' })))));
    expect(ev.filter((e) => e.kind !== "usage")).toEqual([{ kind: "reasoning", agent: "main", delta: "hm" }]);
    expect(ret).toMatchObject({ ok: true, text: '{"a":1}', model: "a", provider: "groq" });
  });
  it("streams answer deltas only when asked", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, sse({ content: "Hi " }, { content: "there" }));
    const text = (r: { ev: CEvent[] }) => r.ev.filter((e) => e.kind !== "usage");
    expect(text(await drain(callModel("main", [], deps(open), { answerDeltas: true })))).toEqual([{ kind: "answer", delta: "Hi " }, { kind: "answer", delta: "there" }]);
    expect(text(await drain(callModel("main", [], deps(open))))).toEqual([]);
  });
  it("falls back past a 429 and puts the rate-limited model on cooldown for the next call", async () => {
    const tried: string[] = [];
    const open = async (p: "groq", m: string) => { tried.push(m); return m === "g/a" ? bad("groq http 429") : ok(p, m, sse({ content: "ok" })); };
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    tried.length = 0;
    await drain(callModel("x", [], deps(open)));
    expect(tried).not.toContain("g/a");
  });
  it("benches an unfunded or retired model (402/403/404/410) for 10 minutes, not 1", async () => {
    let now = 1000;
    const d: ModelDeps = { open: (async (p: "groq", m: string) => (m === "g/a" ? bad("tokenrouter http 403") : ok(p, m, sse({ content: "ok" })))) as unknown as typeof openChat, models: M, now: () => now };
    await drain(callModel("x", [], d));
    now += 120_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).not.toContain("g/a");
    now += 600_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).toContain("g/a");
  });
  it("hands each model its own deadline so a stalled one cannot eat the whole budget", async () => {
    const seen: AbortSignal[] = [];
    const open = async (p: "groq", m: string, _msgs: unknown, opts: { signal?: AbortSignal }) => { if (opts.signal) seen.push(opts.signal); return m === "g/a" ? bad("groq: The operation was aborted due to timeout") : ok(p, m, sse({ content: "ok" })); };
    expect((await drain(callModel("x", [], deps(open), { modelTimeoutMs: 5 }))).ret).toMatchObject({ ok: true, model: "b" });
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
  it("falls back when a stream errors before content, and reports when everything fails", async () => {
    const err = `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`;
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, err) : ok(p, m, sse({ content: "fine" })));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    resetCooldowns();
    expect((await drain(callModel("x", [], deps(async () => bad("down"))))).ret).toEqual({ ok: false, error: "every allowlisted model failed: down" });
  });
  it("stops promptly when aborted", async () => {
    const c = new AbortController();
    c.abort();
    expect((await drain(callModel("x", [], deps(async () => bad("x")), { signal: c.signal }))).ret).toEqual({ ok: false, error: "cancelled" });
  });
  const broken = (part: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\ndata: ${JSON.stringify({ error: { message: "The operation was aborted due to timeout" } })}\n\n`;
  it("does not hand back a reply that broke off part way: the next model gets the call and the cut one rests", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, broken('{"action":"delegate","agent":"rese')) : ok(p, m, sse({ content: '{"a":1}' })));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, text: '{"a":1}', model: "b" });
    expect(orderModels(M, 0, 1000)[0].model).toBe("g/b");
  });
  it("keeps a broken-off reply the person has already seen part of, rather than starting a second one under it", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, broken("The fee is 2.9% ")) : ok(p, m, sse({ content: "something else" })));
    expect((await drain(callModel("x", [], deps(open), { answerDeltas: true }))).ret).toMatchObject({ ok: true, text: "The fee is 2.9% ", model: "a" });
  });
  it("says a model broke off when every reply was cut", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, broken("{"));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: false, error: expect.stringContaining("broke off part way") });
  });
});

describe("callModel reports the tokens it used", () => {
  const withUsage = (...c: object[]) => c.map((x) => `data: ${JSON.stringify(x)}\n\n`).join("") + "data: [DONE]\n\n";
  const msgs = [{ role: "system" as const, content: "Answer briefly." }, { role: "user" as const, content: "What is 2+2?" }];
  it("tells the provider's own count, marked as counted, with the model's window", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, withUsage({ choices: [{ delta: { content: "Four." } }] }, { choices: [], usage: { prompt_tokens: 92, completion_tokens: 27 } }));
    const { ev, ret } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.filter((e) => e.kind === "usage")).toEqual([{ kind: "usage", agent: "main", prompt: 92, completion: 27, window: 128_000, model: "g/a", provider: "groq", exact: true }]);
    expect(ret).toMatchObject({ ok: true, usage: { prompt: 92, completion: 27, exact: true } });
  });
  it("reads Groq's count from x_groq as well", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, withUsage({ choices: [{ delta: { content: "Four." } }] }, { choices: [], x_groq: { usage: { prompt_tokens: 40, completion_tokens: 9 } } }));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.find((e) => e.kind === "usage")).toMatchObject({ prompt: 40, completion: 9, exact: true });
  });
  it("estimates from the actual messages and the text when the provider sent no count, thinking included, and says so", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, sse({ reasoning: "x".repeat(400) }, { content: "Four." }));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    const u = ev.find((e) => e.kind === "usage");
    expect(u).toMatchObject({ exact: false, window: 128_000 });
    expect(u && u.kind === "usage" && u.prompt).toBeGreaterThan(8);
    expect(u && u.kind === "usage" && u.completion).toBeGreaterThan(90); // the 400 characters of thinking count
  });
  it("only the model that answered is reported: a model that failed first costs no event", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 500") : ok(p, m, sse({ content: "ok" })));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.filter((e) => e.kind === "usage")).toHaveLength(1);
    expect(ev.find((e) => e.kind === "usage")).toMatchObject({ model: "g/b" });
  });
  it("a reply that was refused tells nothing: the next model's call is the one that counts", async () => {
    let n = 0;
    const open = async (p: "groq", m: string) => ok(p, m, sse({ content: n++ === 0 ? "prose" : '{"a":1}' }));
    const { ev, ret } = await drain(callModel("main", msgs, deps(open), { accept: (t) => t.startsWith("{") }));
    expect(ev.filter((e) => e.kind === "usage")).toHaveLength(1);
    expect(ret).toMatchObject({ ok: true, text: '{"a":1}' });
  });
});
describe("callModel tells the ring in real time when deps.live is on", () => {
  const msgs = [{ role: "system" as const, content: "Answer briefly." }, { role: "user" as const, content: "What is 2+2?" }];
  const many = (n: number) => sse(...Array.from({ length: n }, (_, i) => ({ content: `word${i} ` })));
  const clock = () => { let t = 0; return () => (t += 200); }; // every read is 200ms later: each piece of the stream is due a report
  const liveDeps = (open: unknown): ModelDeps => ({ open: open as typeof openChat, models: M, now: clock(), live: true });
  it("reports the prompt before the first word, then a growing reply, then the finished call", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(6));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(lives.length).toBeGreaterThan(2);
    expect(lives[0]).toMatchObject({ kind: "usage_live", agent: "main", completion: 0, model: "g/a", provider: "groq" });
    const done = lives.map((e) => (e.kind === "usage_live" ? e.completion : -1));
    expect(done).toEqual([...done].sort((a, b) => a - b)); // never shrinks while streaming
    expect(done.at(-1)).toBeGreaterThan(0);
    expect(ev.at(-1)?.kind).toBe("usage"); // the finished call is told last
  });
  it("every live report carries the same prompt count as the model was really given", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(4));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const prompts = new Set(ev.filter((e) => e.kind === "usage_live").map((e) => (e.kind === "usage_live" ? e.prompt : 0)));
    expect(prompts.size).toBe(1);
    expect([...prompts][0]).toBeGreaterThan(8);
  });
  it("reports nothing live when the flag is off (the default)", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(6));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.some((e) => e.kind === "usage_live")).toBe(false);
  });
  it("announces each model as it is tried, so the last report always names the one that answered", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 500") : ok(p, m, many(3)));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(lives[0]).toMatchObject({ model: "g/a", completion: 0 }); // tried first, failed: its report is replaced, not left behind
    expect(lives.slice(1).every((e) => e.kind === "usage_live" && e.model === "g/b")).toBe(true);
    expect(lives.at(-1)).toMatchObject({ model: "g/b" });
    expect(ev.at(-1)).toMatchObject({ kind: "usage", model: "g/b" });
  });
  it("reports the prompt before the model has even been asked, so a slow connection is not silence", async () => {
    let asked = false;
    const open = async (p: "groq", m: string) => { asked = true; return ok(p, m, many(2)); };
    const g = callModel("main", msgs, liveDeps(open));
    const first = await g.next();
    expect(first.value).toMatchObject({ kind: "usage_live", agent: "main", completion: 0, model: "g/a" });
    expect(asked).toBe(false);
  });
});

describe("callModel gives up on a model that says nothing", () => {
  const silent = (signal?: AbortSignal) => new ReadableStream<Uint8Array>({ start(c) { signal?.addEventListener("abort", () => c.error(new Error("This operation was aborted")), { once: true }); } });
  const opts = (o: unknown) => o as { signal?: AbortSignal };
  it("moves on from a stream that never sends a word, and benches that model", async () => {
    const tried: string[] = [];
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => { tried.push(m); return m === "g/a" ? { ok: true as const, data: { provider: p, model: m, body: silent(opts(o).signal) } } : ok(p, m, sse({ content: "ok" })); };
    const r = await drain(callModel("x", [], deps(open), { firstWordMs: 20 }));
    expect(r.ret).toMatchObject({ ok: true, model: "b" });
    expect(tried).toEqual(["g/a", "g/b"]);
    expect(orderModels(M, 0, 1000).map((m) => m.model)).not.toContain("g/a");
  });
  it("moves on from a connection that never answers at all", async () => {
    const open = (p: "groq", m: string, _msgs: unknown, o: unknown) => (m === "g/a"
      ? new Promise((res) => opts(o).signal?.addEventListener("abort", () => res(bad("groq: This operation was aborted")), { once: true }))
      : Promise.resolve(ok(p, m, sse({ content: "ok" }))));
    expect((await drain(callModel("x", [], deps(open), { firstWordMs: 20 }))).ret).toMatchObject({ ok: true, model: "b" });
  });
  it("says why when every model stayed silent", async () => {
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => ({ ok: true as const, data: { provider: p, model: m, body: silent(opts(o).signal) } });
    const r = await drain(callModel("x", [], { ...deps(open), models: M.slice(0, 2) }, { firstWordMs: 15 }));
    expect(r.ret).toMatchObject({ ok: false });
    expect((r.ret as { error: string }).error).toMatch(/sent nothing for/);
  });
  it("does not hurry a model that is thinking: thinking, or a word, ends the wait", async () => {
    // like a real connection, the body errors when the call is aborted
    const talker = (signal?: AbortSignal) => new ReadableStream<Uint8Array>({
      async start(c) {
        const enc = new TextEncoder();
        signal?.addEventListener("abort", () => { try { c.error(new Error("This operation was aborted")); } catch { /* already closed */ } }, { once: true });
        c.enqueue(enc.encode(sse({ reasoning: "hm" }).replace("data: [DONE]\n\n", "")));
        await new Promise((r) => setTimeout(r, 70)); // well past firstWordMs, but it has already spoken
        try { c.enqueue(enc.encode(sse({ content: "done" }))); c.close(); } catch { /* aborted */ }
      },
    });
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => ({ ok: true as const, data: { provider: p, model: m, body: talker(opts(o).signal) } });
    expect((await drain(callModel("x", [], deps(open), { firstWordMs: 20 }))).ret).toMatchObject({ ok: true, text: "done", model: "a" });
  });
});

describe("orderModels: only the first few take turns to lead", () => {
  it("rotates the first `spread` models and leaves the rest behind them in order", () => {
    const names = (k: number) => orderModels(M, k, 0, new Map(), 2).map((m) => m.model);
    expect(names(0)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
    expect(names(1)).toEqual(["g/b", "g/a", "o/c:free", "o/d:free"]);
    expect(names(2)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
  });
  it("is the whole roster when no spread is given, and holds when the spread is larger than the roster", () => {
    expect(orderModels(M, 1, 0, new Map(), 99).map((m) => m.model)).toEqual(orderModels(M, 1, 0, new Map()).map((m) => m.model));
  });
  it("still drops a leader that is cooling down", () => {
    expect(orderModels(M, 0, 100, new Map([["groq:g/a", 500]]), 2).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free"]);
  });
});

describe("the default roster", () => {
  const r = defaultModelDeps;
  it("holds only models the allowlist lets through, each once", () => {
    for (const m of r.models) expect(isAllowedModel(m.provider, m.model), `${m.provider} ${m.model}`).toBe(true);
    expect(new Set(r.models.map((m) => `${m.provider}:${m.model}`)).size).toBe(r.models.length);
  });
  it("leads with models that answer in seconds, not the ones that think for twenty", () => {
    const lead = r.models.slice(0, r.spread);
    expect(lead.some((m) => /lightning|nano/.test(m.model))).toBe(false);
    expect(r.models.slice(r.spread!).some((m) => /lightning/.test(m.model))).toBe(true);
  });
  it("shares the lead between Groq's three limits and NVIDIA, so three teams at once do not all wait on Groq's 8,000 tokens a minute", () => {
    const lead = r.models.slice(0, r.spread);
    expect(lead.filter((m) => m.provider === "groq")).toHaveLength(3);
    expect(lead.filter((m) => m.provider === "nvidia").length).toBeGreaterThanOrEqual(2);
    // neighbours in the rotation are on different providers, so one step's refusal does not land the next step on the same limit
    for (let i = 1; i < lead.length; i++) expect(lead[i].provider).not.toBe(lead[i - 1].provider);
  });
  it("has three separate Groq models, because each has its own limit of 8,000 tokens a minute", () => {
    expect(r.models.filter((m) => m.provider === "groq")).toHaveLength(3);
  });
  it("has dropped the model this account's gateway no longer serves", () => {
    expect(r.models.some((m) => m.model.includes("muse-glimmer"))).toBe(false);
  });
});

describe("tokenBudget: room to think", () => {
  it("adds room for the models that think before they answer, and nothing for the ones that do not", () => {
    expect(tokenBudget("nvidia/nemotron-3.5-lightning-30b-a3b", 900)).toBe(4400);
    expect(tokenBudget("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", 900)).toBe(3400);
    expect(tokenBudget("nvidia/nemotron-3-ultra-550b-a55b:free", 900)).toBe(2400);
    expect(tokenBudget("openai/gpt-oss-120b", 900)).toBe(900);
    expect(tokenBudget("qwen/qwen3.8-27b", 1400)).toBe(1400);
  });
  it("is what a call really asks each model for, so a thinking model is not cut off mid-thought", async () => {
    const asked: Record<string, number | undefined> = {};
    const d: ModelDeps = {
      open: (async (p: "groq", m: string, _x: unknown, opts: { maxTokens?: number }) => { asked[m] = opts.maxTokens; return m === "nvidia/nemotron-3.5-lightning-30b-a3b" ? ok(p, m, sse({ content: "fine" })) : bad("groq http 500"); }) as unknown as typeof openChat,
      models: [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" }],
      now: () => 1000,
    };
    expect((await drain(callModel("x", [], d, { maxTokens: 700 }))).ret).toMatchObject({ ok: true, model: "nemotron-3.5-lightning-30b-a3b" });
    expect(asked).toEqual({ "openai/gpt-oss-120b": 700, "nvidia/nemotron-3.5-lightning-30b-a3b": 4200 });
  });
});

describe("cooldownFor: how long a refused model is left alone", () => {
  it("benches every model behind a key the provider refuses (401) for ten minutes, so no team is pinned to one", () => {
    expect(cooldownFor("openrouter http 401", false)).toBe(600_000);
  });
  it("benches a gone or unfunded model for ten minutes, and a model at its daily limit for an hour", () => {
    expect(cooldownFor("bluesminds http 404", false)).toBe(600_000);
    expect(cooldownFor("openrouter http 429 daily", false)).toBe(3_600_000);
  });
  it("benches a model at its daily limit for as long as the provider says, up to an hour (Groq's day is a rolling window)", () => {
    expect(cooldownFor("groq http 429 retry 537s daily", false)).toBe(537_500);
    expect(cooldownFor("groq http 429 retry 9000s daily", false)).toBe(3_600_000);
  });
  it("benches a rate-limited model for exactly as long as it says, and half a second more, never above a minute", () => {
    expect(cooldownFor("groq http 429 retry 7s", false)).toBe(7_500);
    expect(cooldownFor("groq http 429 retry 384s", false)).toBe(60_000);
  });
  it("benches other load for a minute, a stall for a minute, and an ordinary failure not at all", () => {
    expect(cooldownFor("groq http 429", false)).toBe(60_000);
    expect(cooldownFor("nvidia http 503", false)).toBe(60_000);
    expect(cooldownFor("nothing", true)).toBe(60_000);
    expect(cooldownFor("bluesminds http 400", false)).toBe(0);
  });
});

describe("callModel and rate limits", () => {
  it("brings a Groq model back as soon as its minute has refilled, not a whole minute later", async () => {
    let now = 1000;
    const d: ModelDeps = { open: (async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 429 retry 4s") : ok(p, m, sse({ content: "ok" })))) as unknown as typeof openChat, models: M, now: () => now };
    await drain(callModel("x", [], d));
    now += 3000;
    expect(orderModels(M, 0, now).map((m) => m.model)).not.toContain("g/a");
    now += 2000;
    expect(orderModels(M, 0, now).map((m) => m.model)).toContain("g/a");
  });
  it("benches a model for an hour when its limit is the day's", async () => {
    let now = 1000;
    const d: ModelDeps = { open: (async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 429 daily") : ok(p, m, sse({ content: "ok" })))) as unknown as typeof openChat, models: M, now: () => now };
    await drain(callModel("x", [], d));
    now += 1_800_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).not.toContain("g/a");
    now += 1_900_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).toContain("g/a");
  });
  it("benches a model that replied with nothing, so the next call does not spend its time on it again", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, sse({ reasoning: "thinking..." })) : ok(p, m, sse({ content: "ok" })));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    expect(orderModels(M, 0, 1000).map((m) => m.model)).not.toContain("g/a");
  });
  it("waits once for a short rate limit when every model has failed, then answers", async () => {
    let now = 1000;
    const slept: number[] = [];
    const limited = new Set(M.map((m) => m.model));
    const d: ModelDeps = {
      open: (async (p: "groq", m: string) => (limited.has(m) ? bad("groq http 429 retry 3s") : ok(p, m, sse({ content: "ok" })))) as unknown as typeof openChat,
      models: M, now: () => now,
      sleep: async (ms) => { slept.push(ms); now += ms; limited.clear(); },
    };
    expect((await drain(callModel("x", [], d))).ret).toMatchObject({ ok: true, text: "ok" });
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(3500);
    expect(slept[0]).toBeLessThan(4000);
  });
  it("does not wait for a limit that is more than a few seconds away, or a model that is simply down", async () => {
    const slept: number[] = [];
    const d = (reason: string): ModelDeps => ({ open: (async () => bad(reason)) as unknown as typeof openChat, models: M, now: () => 1000, sleep: async (ms) => { slept.push(ms); } });
    expect((await drain(callModel("x", [], d("groq http 429 retry 45s")))).ret).toMatchObject({ ok: false });
    resetCooldowns();
    expect((await drain(callModel("x", [], d("groq http 500")))).ret).toMatchObject({ ok: false });
    expect(slept).toEqual([]);
  });
  it("gives up after one wait, not forever", async () => {
    const slept: number[] = [];
    const d: ModelDeps = { open: (async () => bad("groq http 429 retry 2s")) as unknown as typeof openChat, models: M, now: () => 1000, sleep: async (ms) => { slept.push(ms); } };
    expect((await drain(callModel("x", [], d))).ret).toMatchObject({ ok: false });
    expect(slept).toHaveLength(1);
  });
  it("stops waiting when the run is cancelled", async () => {
    const c = new AbortController();
    const d: ModelDeps = { open: (async () => bad("groq http 429 retry 2s")) as unknown as typeof openChat, models: M, now: () => 1000, sleep: async () => { c.abort(); } };
    expect((await drain(callModel("x", [], d, { signal: c.signal }))).ret).toEqual({ ok: false, error: "cancelled" });
  });
});

describe("shortestWait", () => {
  const cool = (...w: [string, number][]) => new Map(w.map(([k, until]) => [k, until] as [string, number]));
  it("is the least time until a cooling model is free, if that is short", () => {
    expect(shortestWait(M, 1000, cool(["groq:g/a", 4000], ["groq:g/b", 2500]))).toBe(1500);
  });
  it("is nothing to wait for when no model is cooling, or when the nearest is far away", () => {
    expect(shortestWait(M, 1000, cool())).toBeNull();
    expect(shortestWait(M, 1000, cool(["groq:g/a", 61_000]))).toBeNull();
    expect(shortestWait(M, 1000, cool(["groq:g/a", 900]))).toBeNull();
  });
});

describe("benchedLong: models nothing should be pinned to", () => {
  it("is true for a model that is gone or out of requests for the day, and false for one that is only catching its breath", async () => {
    const d: ModelDeps = { open: (async (_p: string, m: string) => (m === "g/a" ? bad("groq http 404") : m === "g/b" ? bad("groq http 429 retry 5s") : bad("groq http 500"))) as unknown as typeof openChat, models: M.slice(0, 3), now: () => 1000, sleep: async () => undefined };
    await drain(callModel("x", [], d));
    expect(benchedLong(M[0], 1000)).toBe(true);
    expect(benchedLong(M[1], 1000)).toBe(false);
    expect(benchedLong(M[2], 1000)).toBe(false);
    expect(benchedLong(M[0], 1000 + 600_000)).toBe(false);
  });
});

describe("demote: a model whose reply could not be read goes to the back", () => {
  const R: ModelRef[] = [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" }, { provider: "bluesminds", model: "nvidia/nemotron-3-ultra-550b-a55b" }];
  it("moves only the model on that provider, by the bare name callModel reports", () => {
    expect(demote(R, "nvidia", "nemotron-3-ultra-550b-a55b").map((m) => `${m.provider}:${m.model.split("/").pop()}`)).toEqual(["groq:gpt-oss-120b", "bluesminds:nemotron-3-ultra-550b-a55b", "nvidia:nemotron-3-ultra-550b-a55b"]);
  });
  it("leaves the roster as it is for a model it does not have, and keeps every model", () => {
    expect(demote(R, "groq", "qwen3.8-27b")).toEqual(R);
    expect(demote(R, "groq", "gpt-oss-120b")).toHaveLength(3);
  });
});
