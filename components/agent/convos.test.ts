import { describe, expect, it } from "vitest";
import { applyCEvent, newRun, type Run } from "@/lib/computer/run";
import type { CEvent } from "@/lib/computer/events";
import { BODY_CAP, BODY_PREFIX, BUDGET_CHARS, INDEX_KEY, MAX_CONVOS, bodyOf, kindsOf, loadConvo, readIndex, removeConvos, renameConvo, saveConvo, sigOf, statusOf, titleOf, trimRun, type KV } from "./convos";

/** A stand-in for localStorage that refuses to hold more than `limit` characters, as a full browser does. */
function memory(limit = Infinity): KV & { map: Map<string, string>; used: () => number } {
  const map = new Map<string, string>();
  const used = () => [...map.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    used,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { if (used() - (map.get(k)?.length ?? 0) - (map.has(k) ? k.length : 0) + k.length + v.length > limit) throw new DOMException("full", "QuotaExceededError"); map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}
const fold = (prompt: string, ...e: CEvent[]): Run => e.reduce(applyCEvent, newRun(`r-${prompt}`, prompt));
const done = (prompt: string, answer = "An answer.", ...more: CEvent[]) => fold(prompt, ...more, { kind: "answer", delta: answer }, { kind: "done", used: [], model: "m", ms: 1 });
const big = (n: number) => "x".repeat(n);

describe("what a conversation is called and what it holds", () => {
  it("is titled by the first thing asked, in one line, cut at sixty characters", () => {
    expect(titleOf([{ prompt: "  Compare   PayPal\nand Stripe " }])).toBe("Compare PayPal and Stripe");
    expect(titleOf([{ prompt: big(100) }])).toHaveLength(58);
    expect(titleOf([{ prompt: big(100) }]).endsWith("…")).toBe(true);
    expect(titleOf([])).toBe("Untitled");
  });
  it("lists the kinds of run in order of first appearance, and is a chat when empty", () => {
    const battle = { arena: { mode: "battle" } } as Pick<Run, "arena">;
    const loop = { arena: { mode: "loop" } } as Pick<Run, "arena">;
    expect(kindsOf([{}, battle, {}, loop, battle] as Pick<Run, "arena">[])).toEqual(["chat", "battle", "loop"]);
    expect(kindsOf([])).toEqual(["chat"]);
  });
  it("says where it stands from the latest run: running, waiting for the person, failed, done", () => {
    expect(statusOf([])).toBe("done");
    expect(statusOf([{ status: "done" }, { status: "running" }])).toBe("running");
    expect(statusOf([{ status: "done", handoff: { reason: "r", need: "captcha", url: "u", agent: "a" } }])).toBe("waiting");
    expect(statusOf([{ status: "done" }, { status: "error" }])).toBe("error");
    expect(statusOf([{ status: "error" }, { status: "done" }])).toBe("done");
  });
});

describe("sigOf", () => {
  it("changes when the answer grows or the run ends, not when nothing changed", () => {
    const a = fold("q", { kind: "answer", delta: "he" });
    const b = applyCEvent(a, { kind: "answer", delta: "llo" });
    const c = applyCEvent(b, { kind: "done", used: [], model: "m", ms: 1 });
    expect(sigOf([a])).toBe(sigOf([a]));
    expect(new Set([sigOf([a]), sigOf([b]), sigOf([c])]).size).toBe(3);
    expect(sigOf([])).toBe("");
  });
  it("changes when a message is added", () => expect(sigOf([done("one")])).not.toBe(sigOf([done("one"), done("two")])));
});

describe("trimRun: what is kept of a run", () => {
  const withWork = () => done("q", "The answer [1].",
    { kind: "agent", id: "terminal-1", role: "terminal", title: "TerminalPal", state: "ok" },
    { kind: "reasoning", agent: "terminal-1", delta: big(5000) },
    { kind: "term", agent: "terminal-1", id: "t", command: "ls", state: "ok", out: big(5000) },
    { kind: "file", agent: "terminal-1", id: "f", path: "/workspace/a.md", created: true, adds: 1, removes: 0, preview: big(5000), mode: "write" },
  );
  it("keeps the answer, the sources and the steps, and drops the model's thinking", () => {
    const t = trimRun(withWork());
    expect(t.answer).toBe("The answer [1].");
    expect(t.agents[0].reasoning).toBe("");
    expect(t.agents[0].terms[0].out).toHaveLength(800);
    expect(t.agents[0].files[0].preview).toHaveLength(2000);
  });
  it("trims harder at level 1", () => {
    const t = trimRun(withWork(), 1);
    expect(t.agents[0].terms[0].out).toHaveLength(300);
    expect(t.agents[0].files[0].preview).toHaveLength(600);
  });
  it("forgets what dies with the page: picture thumbnails and the live browser", () => {
    const r = { ...done("q"), images: [{ id: "i", name: "a.png", url: "blob:x" }], liveViewUrl: "https://live.example" };
    const t = trimRun(r);
    expect(t.images).toBeUndefined();
    expect(t.liveViewUrl).toBeUndefined();
  });
  it("a run still going when it is saved is saved as interrupted, and the live run is not touched", () => {
    const live = fold("q", { kind: "answer", delta: "half" });
    const t = trimRun(live);
    expect(t).toMatchObject({ status: "error", error: expect.stringContaining("interrupted") });
    expect(live.status).toBe("running");
  });
  it("trims the contenders inside a Battle too", () => {
    const run = fold("q",
      { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q?", max: 2, adaptive: false, contenders: [{ id: "c1", name: "A", persona: "p", stance: "s", tool: "research" }, { id: "c2", name: "B", persona: "p", stance: "s", tool: "research" }] },
      { kind: "contender", id: "c1", e: { kind: "reasoning", agent: "research-1", delta: big(4000) } },
    );
    const t = trimRun(run);
    expect(t.arena?.contenders).toHaveLength(2);
    expect(t.arena?.contenders[0].run.agents[0].reasoning).toBe("");
  });
});

describe("saving and opening", () => {
  it("saves, lists newest first, and opens what was saved", () => {
    const kv = memory();
    const a = [done("first question", "Alpha.")];
    const e1 = saveConvo(kv, { id: "c1", runs: a, sessionId: "sess-1" }, 1000);
    saveConvo(kv, { id: "c2", runs: [done("second question")], sessionId: null }, 2000);
    expect(e1).toMatchObject({ id: "c1", title: "first question", kinds: ["chat"], runs: 1, status: "done", createdAt: 1000, updatedAt: 1000 });
    expect(readIndex(kv).map((e) => e.id)).toEqual(["c2", "c1"]);
    const back = loadConvo(kv, "c1");
    expect(back).toMatchObject({ id: "c1", sessionId: "sess-1", savedAt: 1000 });
    expect(back?.runs[0].answer).toBe("Alpha.");
  });
  it("saving again updates the entry and keeps when it began", () => {
    const kv = memory();
    saveConvo(kv, { id: "c1", runs: [done("q")], sessionId: null }, 1000);
    const e = saveConvo(kv, { id: "c1", runs: [done("q"), done("and then?")], sessionId: "s" }, 5000);
    expect(e).toMatchObject({ createdAt: 1000, updatedAt: 5000, runs: 2 });
    expect(readIndex(kv)).toHaveLength(1);
  });
  it("an empty conversation is not saved", () => {
    const kv = memory();
    expect(saveConvo(kv, { id: "c1", runs: [], sessionId: null }, 1)).toBeNull();
    expect(kv.map.size).toBe(0);
  });
  it("renames (kept to 80 characters, a blank title ignored) and removes", () => {
    const kv = memory();
    saveConvo(kv, { id: "c1", runs: [done("q")], sessionId: null }, 1);
    saveConvo(kv, { id: "c2", runs: [done("w")], sessionId: null }, 2);
    renameConvo(kv, "c1", `  ${big(200)}  `);
    renameConvo(kv, "c2", "   ");
    expect(readIndex(kv).find((e) => e.id === "c1")?.title).toHaveLength(80);
    expect(readIndex(kv).find((e) => e.id === "c2")?.title).toBe("w");
    removeConvos(kv, ["c1"]);
    expect(readIndex(kv).map((e) => e.id)).toEqual(["c2"]);
    expect(kv.getItem(BODY_PREFIX + "c1")).toBeNull();
  });
});

describe("reading what the browser kept without trusting it", () => {
  it.each([[null], ["not json"], ["{}"], ['[{"id":1}]'], ['[null,"x"]']])("an index of %j is empty", (raw) => {
    const kv = memory();
    if (raw !== null) kv.map.set(INDEX_KEY, raw);
    expect(readIndex(kv)).toEqual([]);
  });
  it("an index entry missing optional fields is mended, one that is not an entry is dropped", () => {
    const kv = memory();
    kv.map.set(INDEX_KEY, JSON.stringify([{ id: "a", title: "T", updatedAt: 5 }, { id: "b" }]));
    expect(readIndex(kv)).toEqual([{ id: "a", title: "T", updatedAt: 5, kinds: ["chat"], size: 0, createdAt: 5, runs: 1 }]);
  });
  it("a body that is missing, broken or empty opens as nothing", () => {
    const kv = memory();
    expect(loadConvo(kv, "none")).toBeNull();
    kv.map.set(BODY_PREFIX + "bad", "{oops");
    expect(loadConvo(kv, "bad")).toBeNull();
    kv.map.set(BODY_PREFIX + "empty", JSON.stringify({ runs: [] }));
    expect(loadConvo(kv, "empty")).toBeNull();
  });
  it("a stored run that lacks the lists the screen reads is mended, and one that was left running is shown as interrupted", () => {
    const kv = memory();
    kv.map.set(BODY_PREFIX + "c", JSON.stringify({ runs: [{ id: "r", prompt: "p", status: "running" }, { nope: true }] }));
    const c = loadConvo(kv, "c");
    expect(c?.runs).toHaveLength(1);
    expect(c?.runs[0]).toMatchObject({ agents: [], messages: [], timeline: [], sources: [], visits: [], spawns: [], used: [], attachments: [], answer: "", status: "error" });
  });
});

describe("a full browser", () => {
  it("one conversation is kept within its own size: trimmed harder first, the oldest messages dropped last", () => {
    const heavy = (p: string) => done(p, big(40_000), { kind: "agent", id: "terminal-1", role: "terminal", title: "T", state: "ok" }, { kind: "file", agent: "terminal-1", id: "f", path: "/workspace/a.md", created: true, adds: 1, removes: 0, preview: big(2000), mode: "write" });
    const runs = Array.from({ length: 30 }, (_, i) => heavy(`question ${i}`));
    const { text, runs: kept } = bodyOf(runs, null, 1, "c");
    expect(text.length).toBeLessThanOrEqual(BODY_CAP);
    expect(kept.length).toBeLessThan(30);
    expect(kept.at(-1)?.prompt).toBe("question 29"); // the latest is what is kept
  });
  it("makes room by letting go of the oldest other conversation when the browser refuses", () => {
    const one = JSON.stringify({ id: "x", runs: [trimRun(done("q", big(3000)))], sessionId: null, savedAt: 1 }).length;
    const kv = memory(one * 2.5 + 400);
    saveConvo(kv, { id: "old", runs: [done("old q", big(3000))], sessionId: null }, 1);
    saveConvo(kv, { id: "mid", runs: [done("mid q", big(3000))], sessionId: null }, 2);
    const e = saveConvo(kv, { id: "new", runs: [done("new q", big(3000))], sessionId: null }, 3);
    expect(e?.id).toBe("new");
    expect(readIndex(kv).map((x) => x.id)).toEqual(["new", "mid"]);
    expect(kv.getItem(BODY_PREFIX + "old")).toBeNull();
  });
  it("when even an empty browser could not hold it, nothing changes and null comes back", () => {
    const kv = memory(50);
    expect(saveConvo(kv, { id: "c", runs: [done("q")], sessionId: null }, 1)).toBeNull();
    expect(readIndex(kv)).toEqual([]);
  });
  it("keeps at most the newest sixty conversations, and stays inside the character budget", () => {
    const kv = memory();
    for (let i = 0; i < MAX_CONVOS + 5; i++) saveConvo(kv, { id: `c${i}`, runs: [done(`q${i}`)], sessionId: null }, i + 1);
    const idx = readIndex(kv);
    expect(idx).toHaveLength(MAX_CONVOS);
    expect(idx[0].id).toBe(`c${MAX_CONVOS + 4}`);
    expect(kv.getItem(BODY_PREFIX + "c0")).toBeNull();
    expect(idx.reduce((n, e) => n + e.size, 0)).toBeLessThan(BUDGET_CHARS);
  });
});
