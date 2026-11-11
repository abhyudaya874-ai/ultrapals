import { describe, expect, it } from "vitest";
import type { CEvent } from "@/lib/computer/events";
import { applyCEvent, newRun, type Run } from "@/lib/computer/run";
import { collectiveFor, toolTotal } from "./context";

const fold = (...e: CEvent[]): Run => e.reduce(applyCEvent, newRun("r", "q"));
const agent = (id: string, role: "main" | "browser" | "terminal" | "research", state: "running" | "ok" | "error" = "running"): CEvent => ({ kind: "agent", id, role, title: id, state });
const use = (a: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage" }>> = {}): CEvent => ({ kind: "usage", agent: a, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true, ...o });
const live = (a: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage_live" }>> = {}): CEvent => ({ kind: "usage_live", agent: a, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", ...o });

describe("collectiveFor", () => {
  it("is null before any agent has called a model, and for no run", () => {
    expect(collectiveFor(undefined)).toBeNull();
    expect(collectiveFor(fold(agent("main", "main")))).toBeNull();
  });

  it("adds up every agent, UltraPal first, each against its own window", () => {
    const c = collectiveFor(fold(
      agent("main", "main"), agent("browser-1", "browser"), agent("terminal-1", "terminal"),
      use("browser-1", 6000, 300), use("main", 2000, 100), use("terminal-1", 3000, 200, { window: 262_144, model: "nvidia/nemotron-3.5-lightning-30b-a3b", provider: "nvidia" }),
    ))!;
    expect(c.agents.map((a) => a.id)).toEqual(["main", "browser-1", "terminal-1"]);
    expect(c.agents.map((a) => a.name)).toEqual(["UltraPal", "BrowserPal", "TerminalPal"]);
    expect(c.used).toBe(2100 + 6300 + 3200);
    expect(c.window).toBe(131_072 + 131_072 + 262_144);
    expect(c.spent).toBe(2100 + 6300 + 3200);
    expect(c.working).toBe(3);
    expect(c.worst).toBe(5); // BrowserPal: 6300 of 131072
    expect(c.exact).toBe(true);
  });

  it("moves in real time while any one agent streams, and the sum is not tied to UltraPal's call", () => {
    const base = [agent("main", "main", "ok"), agent("browser-1", "browser"), use("main", 2000, 100)] as CEvent[];
    const a = collectiveFor(fold(...base, live("browser-1", 5000, 0)))!;
    const b = collectiveFor(fold(...base, live("browser-1", 5000, 800)))!;
    expect(a.used).toBe(2100 + 5000);
    expect(b.used).toBe(2100 + 5800);
    expect(b.live).toBe(true);
    expect(b.exact).toBe(false);
    expect(b.spent).toBe(2100 + 5800); // what the running call has spent so far counts
    expect(b.agents[1].live).toBe(true);
    expect(b.calls).toBe(1); // only finished calls are counted
  });

  it("is exact again when the running call finishes", () => {
    const c = collectiveFor(fold(agent("main", "main"), agent("browser-1", "browser"), live("browser-1", 5000, 800), use("browser-1", 5010, 790)))!;
    expect(c.live).toBe(false);
    expect(c.exact).toBe(true);
    expect(c.agents.find((a) => a.id === "browser-1")).toMatchObject({ used: 5800, calls: 1, spent: 5800 });
    expect(c.used).toBe(5800); // UltraPal is listed (it is running) but has called no model, so it adds nothing
  });

  it("lists a Pal the moment it starts, before it has called a model, and it adds nothing to the sums", () => {
    const step = (a: string, label: string): CEvent => ({ kind: "step", agent: a, id: label, label, state: "running" });
    const c = collectiveFor(fold(agent("main", "main"), use("main", 2000, 100), agent("browser-1", "browser"), step("browser-1", "Starting a cloud computer")))!;
    expect(c.agents.map((a) => a.id)).toEqual(["main", "browser-1"]);
    expect(c.agents[1]).toMatchObject({ name: "BrowserPal", used: 0, window: 0, pct: 0, model: null, calls: 0, doing: "working", step: "Starting a cloud computer", live: false });
    expect(c.used).toBe(2100);
    expect(c.window).toBe(131_072);
    expect(c.working).toBe(2);
  });
  it("lists a finished script Pal too, with what it did and no model", () => {
    const c = collectiveFor(fold(agent("main", "main"), use("main", 100, 10), agent("promise-1", "research", "ok"), { kind: "step", agent: "promise-1", id: "s", label: "Created the promise", state: "ok" }))!;
    expect(c.agents[1]).toMatchObject({ id: "promise-1", doing: null, model: null });
    expect(c.agents[1].tools.steps).toBe(1);
  });

  it("counts what each agent did besides thinking", () => {
    const c = collectiveFor(fold(
      agent("browser-1", "browser"), agent("terminal-1", "terminal"),
      { kind: "step", agent: "browser-1", id: "s1", label: "Clicked", state: "ok" }, { kind: "step", agent: "browser-1", id: "s2", label: "Scrolled", state: "ok" },
      { kind: "page", url: "https://stripe.com/pricing", title: "Stripe" },
      { kind: "term", agent: "terminal-1", id: "t1", command: "ls", state: "ok", exit: 0 }, { kind: "term", agent: "terminal-1", id: "t2", command: "pwd", state: "ok", exit: 0 },
      use("browser-1", 100, 10), use("terminal-1", 100, 10),
    ))!;
    const [b, t] = c.agents;
    expect(b.tools).toEqual({ steps: 2, commands: 0, files: 0, searches: 0, pages: 1, spawned: 0, messages: 0 });
    expect(t.tools).toMatchObject({ commands: 2 });
    expect(toolTotal(b.tools)).toBe(3);
  });

  it("counts what UltraPal itself did: the Pals it sent out and the messages it sent", () => {
    const c = collectiveFor(fold(
      agent("main", "main"), { kind: "agent", id: "research-1", role: "research", title: "ResearchPal", state: "ok", parent: "main" },
      { kind: "spawn", parent: "main", child: "research-1", why: "needs sources", decision: "admitted" },
      { kind: "spawn", parent: "main", child: "browser-1", why: "too many", decision: "denied" },
      { kind: "message", id: "to-research-1", from: "main", to: "research-1", text: "find it" },
      { kind: "message", id: "from-research-1", from: "research-1", to: "main", text: "found" },
      use("main", 100, 10), use("research-1", 100, 10),
    ))!;
    expect(c.agents[0].tools).toMatchObject({ spawned: 1, messages: 1 });
    expect(c.agents[1].tools).toMatchObject({ spawned: 0, messages: 1 });
    expect(toolTotal(c.agents[0].tools)).toBe(2);
  });
  it("says what each agent is doing: waiting for a model, hearing it, running a step, or nothing", () => {
    const step = (a: string, label: string, state: "running" | "ok"): CEvent => ({ kind: "step", agent: a, id: label, label, state });
    const c = collectiveFor(fold(
      agent("main", "main"), agent("browser-1", "browser"), agent("terminal-1", "terminal"), agent("research-1", "research", "ok"),
      live("main", 2000, 0), live("browser-1", 900, 120), use("terminal-1", 500, 40), step("terminal-1", "Running node -v", "running"), use("research-1", 700, 90),
    ))!;
    const by = Object.fromEntries(c.agents.map((a) => [a.id, a]));
    expect(by.main).toMatchObject({ doing: "waiting", step: null });
    expect(by["browser-1"]).toMatchObject({ doing: "writing" });
    expect(by["terminal-1"]).toMatchObject({ doing: "working", step: "Running node -v" });
    expect(by["research-1"]).toMatchObject({ doing: null, step: null });
  });
  it("a running call adds its own tokens to what the run has spent, on top of the finished calls", () => {
    const c = collectiveFor(fold(agent("browser-1", "browser"), use("browser-1", 9000, 400), live("browser-1", 3000, 100)))!;
    expect(c.agents[0].used).toBe(3100); // what the call running now holds
    expect(c.spent).toBe(9400 + 3100); // what the run has spent: the finished call plus the running one
  });
  it("keeps the model list apart per agent and sums an agent's spent tokens over all its calls", () => {
    const c = collectiveFor(fold(agent("browser-1", "browser"), use("browser-1", 1000, 100), use("browser-1", 1500, 150, { model: "openai/gpt-oss-20b" })))!;
    expect(c.agents[0]).toMatchObject({ calls: 2, spent: 2750, used: 1650, model: "openai/gpt-oss-20b" });
  });

  it("an agent id the run never announced still counts (a planner, a judge)", () => {
    const c = collectiveFor(fold(use("plan", 500, 50)))!;
    expect(c.agents.map((a) => a.id)).toEqual(["plan"]);
    expect(c.agents[0].state).toBeNull();
  });

  it("names agents with the function it is given", () => {
    const c = collectiveFor(fold(agent("main", "main"), use("main", 100, 10)), (id) => (id === "main" ? "Judge and writer" : id))!;
    expect(c.agents[0].name).toBe("Judge and writer");
  });
});
