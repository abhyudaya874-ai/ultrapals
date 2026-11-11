import { describe, expect, it } from "vitest";
import type { ArenaMode } from "@/lib/arena/mode";
import type { CEvent } from "@/lib/computer/events";
import { applyCEvent, newRun, type Run } from "@/lib/computer/run";
import { ringsFor } from "./rings";
import { MAIN_BASELINE_TOKENS, SMALLEST_WINDOW, estimateTokens } from "./tokens";

const chat: ArenaMode = { kind: "chat", n: 4, plan: "auto" };
const battle = (n: number): ArenaMode => ({ kind: "battle", n, plan: "auto" });
const loop = (n: number): ArenaMode => ({ kind: "loop", n, plan: "auto" });
const use = (agent: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage" }>> = {}): CEvent => ({ kind: "usage", agent, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true, ...o });
const fold = (id: string, ...e: CEvent[]): Run => e.reduce(applyCEvent, newRun(id, "q"));
const contenders = (n: number, mode: "battle" | "loop" = "battle") => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: mode === "battle" ? ["Skeptic", "Pragmatist", "Maximalist", "Rigorist", "Cost cutter", "Contrarian"][i] : `Round ${i + 1}`, persona: "p", stance: "s", tool: "research" as const, ...(mode === "loop" ? { scenarioName: ["Base case", "Half the budget", "Hostile"][i] ?? "Another" } : {}) }));
const arenaRun = (mode: "battle" | "loop", n: number, max = n, ...more: CEvent[]) => fold("a", { kind: "arena", mode, plan: "auto", scenario: "s", question: "q?", max, adaptive: mode === "loop", contenders: contenders(n, mode) }, ...more);

describe("a chat has one ring", () => {
  it("before any call it shows what UltraPal's instructions take, as an estimate", () => {
    const [r] = ringsFor({ mode: chat, runs: [], draft: "", busy: false });
    expect(r).toMatchObject({ key: "chat", label: "UltraPal", used: MAIN_BASELINE_TOKENS, window: SMALLEST_WINDOW, exact: false, started: false, model: null, calls: 0 });
  });
  it("after calls it shows the latest one: what was sent plus what came back, with that model's window", () => {
    const run = fold("r", use("main", 2000, 100), use("browser-1", 9000, 400), use("main", 3100, 240, { window: 1_000_000, model: "nvidia/nemotron-3-ultra-550b-a55b:free", provider: "openrouter" }));
    const [r] = ringsFor({ mode: chat, runs: [run], draft: "", busy: false });
    expect(r).toMatchObject({ used: 3340, window: 1_000_000, prompt: 3100, completion: 240, exact: true, calls: 2, started: true, model: "nvidia/nemotron-3-ultra-550b-a55b:free", provider: "openrouter" });
    expect(r.tokens).toBe(2000 + 100 + 9000 + 400 + 3100 + 240); // everything the run spent, other agents included
  });
  it("another agent's call is not UltraPal's context", () => {
    const [r] = ringsFor({ mode: chat, runs: [fold("r", use("browser-1", 9000, 400))], draft: "", busy: false });
    expect(r.started).toBe(false);
  });
  it("the message being typed adds to it, as an estimate", () => {
    const run = fold("r", use("main", 3000, 100));
    const text = "Compare the three payment rails for a marketplace with fees in the cents range.";
    const [r] = ringsFor({ mode: chat, runs: [run], draft: text, busy: false });
    expect(r.draft).toBe(estimateTokens(text));
    expect(r.used).toBe(3100 + estimateTokens(text));
    expect(r.exact).toBe(true); // the count is the provider's; only the draft is a guess, and the tooltip says so
  });
  it("uses the latest conversation turn that made a call, skipping a run that has made none yet", () => {
    const old = fold("r1", use("main", 4000, 100));
    const fresh = newRun("r2", "next question");
    expect(ringsFor({ mode: chat, runs: [old, fresh], draft: "", busy: true })[0].used).toBe(4100);
  });
  it("a Battle in the thread does not count as the chat's context", () => {
    const chatRun = fold("r1", use("main", 4000, 100));
    expect(ringsFor({ mode: chat, runs: [chatRun, arenaRun("battle", 2)], draft: "", busy: false })[0].used).toBe(4100);
  });
  it("an estimated count says so", () => {
    expect(ringsFor({ mode: chat, runs: [fold("r", use("main", 100, 20, { exact: false }))], draft: "", busy: false })[0].exact).toBe(false);
  });
});

describe("a Battle has a ring per team", () => {
  it("as many as are chosen, before anything has run", () => {
    for (const n of [2, 3, 6]) expect(ringsFor({ mode: battle(n), runs: [], draft: "", busy: false })).toHaveLength(n);
    const rs = ringsFor({ mode: battle(3), runs: [], draft: "", busy: false });
    expect(rs.map((r) => r.label)).toEqual(["Team 1", "Team 2", "Team 3"]);
    expect(rs.every((r) => !r.started && !r.exact && r.used === MAIN_BASELINE_TOKENS)).toBe(true);
    expect(new Set(rs.map((r) => r.key)).size).toBe(3);
  });
  it("while it runs, each team shows its own real use", () => {
    const run = arenaRun("battle", 3, 3,
      { kind: "contender", id: "c1", e: use("main", 5000, 200) },
      { kind: "contender", id: "c2", e: use("main", 1200, 80, { window: 262_144 }) },
      { kind: "contender", id: "c1", e: use("main", 7000, 300) },
    );
    const rs = ringsFor({ mode: battle(3), runs: [run], draft: "", busy: true });
    expect(rs.map((r) => r.label)).toEqual(["Team 1 · Skeptic", "Team 2 · Pragmatist", "Team 3 · Maximalist"]);
    expect(rs.map((r) => r.used)).toEqual([7300, 1280, MAIN_BASELINE_TOKENS]);
    expect(rs.map((r) => r.started)).toEqual([true, true, false]);
    expect(rs[1].window).toBe(262_144);
    expect(rs[0].calls).toBe(2);
  });
  it("the typed message does not change a contest that is running", () => {
    const run = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: use("main", 5000, 200) });
    expect(ringsFor({ mode: battle(2), runs: [run], draft: "something new", busy: true })[0].used).toBe(5200);
  });
  it("after it finishes the real numbers stay while nothing new is typed and the same count is chosen", () => {
    const run = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: use("main", 5000, 200) });
    expect(ringsFor({ mode: battle(2), runs: [run], draft: "", busy: false })[0].used).toBe(5200);
  });
  it("but typing the next question, or choosing another count, shows what a new contest would start with", () => {
    const run = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: use("main", 5000, 200) });
    const typed = ringsFor({ mode: battle(2), runs: [run], draft: "next?", busy: false });
    expect(typed.every((r) => !r.started)).toBe(true);
    expect(typed[0].used).toBe(MAIN_BASELINE_TOKENS + estimateTokens("next?"));
    expect(ringsFor({ mode: battle(4), runs: [run], draft: "", busy: false })).toHaveLength(4);
  });
  it("a Battle's rings are not shown for a Loop", () => {
    const run = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: use("main", 5000, 200) });
    expect(ringsFor({ mode: loop(3), runs: [run], draft: "", busy: false }).every((r) => !r.started)).toBe(true);
  });
});

describe("a Loop has a ring per round", () => {
  it("as many as the most rounds chosen", () => {
    expect(ringsFor({ mode: loop(5), runs: [], draft: "", busy: false })).toHaveLength(5);
    expect(ringsFor({ mode: loop(5), runs: [], draft: "", busy: false })[2].label).toBe("Round 3");
  });
  it("while it runs, the rounds so far show their use and the rest wait", () => {
    const run = arenaRun("loop", 2, 4, { kind: "contender", id: "c1", e: use("main", 4000, 100) }, { kind: "contender", id: "c2", e: use("main", 4500, 150) });
    const rs = ringsFor({ mode: loop(4), runs: [run], draft: "", busy: true });
    expect(rs).toHaveLength(4);
    expect(rs.map((r) => r.label)).toEqual(["Round 1 · Base case", "Round 2 · Half the budget", "Round 3", "Round 4"]); // a round that has not begun has no scenario yet
    expect(rs.map((r) => r.started)).toEqual([true, true, false, false]);
    expect(rs[1].used).toBe(4650);
  });
  it("a round that has a name of its scenario shows it", () => {
    const run = arenaRun("loop", 2, 3, { kind: "contender", id: "c1", e: use("main", 10, 1) });
    const rs = ringsFor({ mode: loop(3), runs: [run], draft: "", busy: true });
    expect(rs[0].label).toBe("Round 1 · Base case");
    expect(rs[1].label).toBe("Round 2 · Half the budget");
  });
  it("a loop that stopped early shows the rounds that ran", () => {
    const run = arenaRun("loop", 2, 5, { kind: "contender", id: "c1", e: use("main", 10, 1) });
    // 5 chosen, 2 ran, results on screen: the count chosen still matches the most rounds, so the real numbers stay
    expect(ringsFor({ mode: loop(5), runs: [run], draft: "", busy: false })).toHaveLength(5);
    expect(ringsFor({ mode: loop(5), runs: [run], draft: "", busy: false })[0].started).toBe(true);
  });
});
