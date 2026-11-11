import { describe, expect, it } from "vitest";
import type { CEvent } from "./events";
import { applyCEvent, newRun, parseCStream, subagents } from "./run";

const fold = (evs: CEvent[]) => evs.reduce(applyCEvent, newRun("r1", "build a page"));

describe("applyCEvent", () => {
  it("folds a delegated run: agent rows, messages in order, steps, terminal, files, answer", () => {
    const r = fold([
      { kind: "agent", id: "main", role: "main", title: "Computer", state: "running" },
      { kind: "message", id: "m1", from: "main", to: "terminal-1", text: "Create a vite app" },
      { kind: "agent", id: "terminal-1", role: "terminal", title: "Terminal", state: "running" },
      { kind: "step", agent: "terminal-1", id: "s1", label: "Running npm init", state: "running" },
      { kind: "term", agent: "terminal-1", id: "t1", command: "npm init -y", state: "running", out: "Wrote " },
      { kind: "term", agent: "terminal-1", id: "t1", command: "npm init -y", state: "ok", out: "to package.json", exit: 0, ms: 900 },
      { kind: "file", agent: "terminal-1", id: "f1", path: "/workspace/index.html", created: true, adds: 12, removes: 0, preview: "<h1>hi</h1>" },
      { kind: "step", agent: "terminal-1", id: "s1", label: "Ran npm init", state: "ok", ms: 900 },
      { kind: "agent", id: "terminal-1", role: "terminal", title: "Terminal", state: "ok", ms: 4000 },
      { kind: "message", id: "m2", from: "terminal-1", to: "main", text: "Done." },
      { kind: "answer", delta: "It is " }, { kind: "answer", delta: "ready." },
      { kind: "done", used: [], model: "gpt-oss-120b · groq", ms: 8000 },
    ]);
    expect(r.timeline).toEqual([{ t: "agent", id: "main" }, { t: "message", id: "m1" }, { t: "agent", id: "terminal-1" }, { t: "message", id: "m2" }]);
    const t = r.agents.find((a) => a.id === "terminal-1")!;
    expect(t).toMatchObject({ state: "ok", ms: 4000, steps: [{ id: "s1", label: "Ran npm init", state: "ok" }] });
    expect(t.terms).toEqual([{ id: "t1", command: "npm init -y", state: "ok", out: "Wrote to package.json", exit: 0, ms: 900 }]);
    expect(t.files).toHaveLength(1);
    expect(r).toMatchObject({ answer: "It is ready.", status: "done", model: "gpt-oss-120b · groq" });
    expect(subagents(r).map((a) => a.id)).toEqual(["terminal-1"]);
  });
  it("creates a blank row when an event arrives before its agent announces itself", () => {
    const r = fold([{ kind: "step", agent: "browser-1", id: "s", label: "x", state: "running" }]);
    expect(r.agents[0]).toMatchObject({ id: "browser-1", role: "browser", steps: [{ id: "s" }] });
    expect(r.timeline).toEqual([{ t: "agent", id: "browser-1" }]);
  });
  it("keeps only the tail of a huge terminal output", () => {
    const r = fold([{ kind: "term", agent: "terminal-1", id: "t", command: "yes", state: "running", out: "x".repeat(30_000) }]);
    expect(r.agents[0].terms[0].out).toHaveLength(20_000);
  });
  it("tracks workspace, page, sources and errors without touching the answer", () => {
    const r = fold([{ kind: "workspace", liveViewUrl: "https://a.kernel.sh/x" }, { kind: "page", url: "https://a.example", title: "A" }, { kind: "answer", delta: "part" }, { kind: "error", message: "busy" }]);
    expect(r).toMatchObject({ liveViewUrl: "https://a.kernel.sh/x", page: { url: "https://a.example", title: "A" }, answer: "part", status: "error", error: "busy" });
  });
  it("does not mutate the previous run", () => {
    const a = newRun("r", "p");
    applyCEvent(a, { kind: "answer", delta: "x" });
    expect(a.answer).toBe("");
  });
});

describe("parseCStream", () => {
  const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  it("parses complete events, keeps the tail and skips junk", () => {
    const r = parseCStream("data: nope\n\n" + ev({ x: 1 }) + ev({ kind: "answer", delta: "a" }) + 'data: {"kind":"ans');
    expect(r.events).toEqual([{ kind: "answer", delta: "a" }]);
    expect(r.rest).toBe('data: {"kind":"ans');
  });
});

describe("applyCEvent: tokens", () => {
  const use = (agent: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage" }>> = {}): CEvent => ({ kind: "usage", agent, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true, ...o });
  it("a run with no model call has no usage", () => expect(fold([]).usage).toBeUndefined());
  it("keeps the latest call of each agent, counts its calls, and adds up every token spent", () => {
    const r = fold([use("main", 2000, 100), use("browser-1", 900, 60), use("main", 3100, 140, { exact: false })]);
    expect(r.usage?.byAgent.main).toEqual({ prompt: 3100, completion: 140, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: false, calls: 2 });
    expect(r.usage?.byAgent["browser-1"]).toMatchObject({ prompt: 900, calls: 1 });
    expect(r.usage).toMatchObject({ tokens: 2000 + 100 + 900 + 60 + 3100 + 140, calls: 3 });
  });
  it("a team in a Battle keeps its own tokens, apart from the others and from the run around them", () => {
    const r = fold([
      { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q?", max: 2, adaptive: false, contenders: [{ id: "c1", name: "A", persona: "p", stance: "s", tool: "research" }, { id: "c2", name: "B", persona: "p", stance: "s", tool: "research" }] },
      { kind: "contender", id: "c1", e: use("main", 5000, 200) },
      { kind: "contender", id: "c2", e: use("main", 1200, 80) },
      { kind: "contender", id: "c1", e: use("main", 7000, 300) },
    ]);
    expect(r.arena?.contenders[0].run.usage?.byAgent.main).toMatchObject({ prompt: 7000, calls: 2 });
    expect(r.arena?.contenders[1].run.usage?.byAgent.main).toMatchObject({ prompt: 1200, calls: 1 });
    expect(r.usage).toBeUndefined();
  });
  it("is not changed by any other event", () => {
    const r = fold([use("main", 10, 5), { kind: "answer", delta: "hi" }, { kind: "done", used: [], model: "m", ms: 1 }]);
    expect(r.usage?.tokens).toBe(15);
  });
  const live = (agent: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage_live" }>> = {}): CEvent => ({ kind: "usage_live", agent, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", ...o });
  it("a call in progress moves the agent's number at once but is not counted in the totals", () => {
    const r = fold([use("main", 2000, 100), live("main", 2600, 0), live("main", 2600, 340)]);
    expect(r.usage?.byAgent.main).toEqual({ prompt: 2600, completion: 340, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: false, calls: 1, live: true });
    expect(r.usage).toMatchObject({ tokens: 2100, calls: 1 });
  });
  it("the finished call replaces the live one, counts once, and is no longer live", () => {
    const r = fold([use("main", 2000, 100), live("main", 2600, 340), use("main", 2650, 360)]);
    expect(r.usage?.byAgent.main).toEqual({ prompt: 2650, completion: 360, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true, calls: 2 });
    expect(r.usage).toMatchObject({ tokens: 2100 + 2650 + 360, calls: 2 });
  });
  it("the first call of an agent shows live before it has ever finished, with no calls counted yet", () => {
    const r = fold([live("main", 1900, 0)]);
    expect(r.usage?.byAgent.main).toMatchObject({ prompt: 1900, calls: 0, live: true });
    expect(r.usage).toMatchObject({ tokens: 0, calls: 0 });
  });
  it("a call that never finished stops being live when the run ends, either way", () => {
    for (const end of [{ kind: "done", used: [], model: "m", ms: 1 } as CEvent, { kind: "error", message: "x" } as CEvent]) {
      const r = fold([live("main", 2600, 340), end]);
      expect(r.usage?.byAgent.main.live).toBeUndefined();
      expect(r.usage?.byAgent.main).toMatchObject({ prompt: 2600, completion: 340, exact: false });
    }
  });
  it("lists every model an agent used, with its calls and tokens, in the order first used", () => {
    const r = fold([use("browser-1", 900, 60), use("browser-1", 1000, 80, { model: "openai/gpt-oss-20b" }), use("browser-1", 1100, 40, { exact: false })]);
    expect(r.usage?.models?.["browser-1"]).toEqual([
      { model: "openai/gpt-oss-120b", provider: "groq", calls: 2, prompt: 2000, completion: 100, exact: false },
      { model: "openai/gpt-oss-20b", provider: "groq", calls: 1, prompt: 1000, completion: 80, exact: true },
    ]);
  });
  it("a live report does not add to the models list", () => {
    expect(fold([live("main", 100, 5)]).usage?.models).toBeUndefined();
  });
  it("remembers the smallest window among the models an agent has been on, from running and finished calls alike", () => {
    const r = fold([live("main", 100, 0, { window: 1_000_000 }), use("main", 100, 5, { window: 262_144 }), live("main", 100, 0, { window: 131_072 }), use("main", 100, 5, { window: 1_000_000 })]);
    expect(r.usage?.floor).toEqual({ main: 131_072 });
  });
  it("a call that never reported an end stops being live when its agent finishes, without touching other agents", () => {
    const a = (id: string, state: "running" | "ok" | "error"): CEvent => ({ kind: "agent", id, role: "browser", title: id, state });
    const r = fold([a("browser-1", "running"), a("terminal-1", "running"), live("browser-1", 800, 40), live("terminal-1", 500, 10), a("browser-1", "error")]);
    expect(r.usage?.byAgent["browser-1"].live).toBeUndefined();
    expect(r.usage?.byAgent["browser-1"]).toMatchObject({ prompt: 800, completion: 40 });
    expect(r.usage?.byAgent["terminal-1"].live).toBe(true);
    expect(fold([a("browser-1", "running"), live("browser-1", 800, 40), a("browser-1", "running")]).usage?.byAgent["browser-1"].live).toBe(true);
  });
});
