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
  it("after calls it adds up what every agent holds, each against the smallest window it has been on", () => {
    const run = fold("r", use("main", 2000, 100), use("browser-1", 9000, 400), use("main", 3100, 240, { window: 1_000_000, model: "nvidia/nemotron-3-ultra-550b-a55b:free", provider: "openrouter" }));
    const [r] = ringsFor({ mode: chat, runs: [run], draft: "", busy: false });
    expect(r).toMatchObject({ used: 3340 + 9400, window: 131_072 + 131_072, prompt: 3100 + 9000, completion: 240 + 400, exact: true, calls: 3, started: true, working: 0, worst: 7 });
    expect(r.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free"); // the lead is still UltraPal's model
    expect(r.agents.map((a) => [a.id, a.used])).toEqual([["main", 3340], ["browser-1", 9400]]);
    expect(r.tokens).toBe(2000 + 100 + 9000 + 400 + 3100 + 240);
  });
  it("follows the call running now, even when it starts smaller than the last one, and grows with its reply", () => {
    const run = fold("r", use("browser-1", 9000, 400), { kind: "usage_live", agent: "browser-1", prompt: 3000, completion: 0, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq" });
    const [r] = ringsFor({ mode: chat, runs: [run], draft: "", busy: true });
    expect(r.agents[0]).toMatchObject({ used: 3000, prompt: 3000, completion: 0, live: true });
    expect(r.used).toBe(3000);
    const grown = applyCEvent(run, { kind: "usage_live", agent: "browser-1", prompt: 3000, completion: 7000, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq" });
    expect(ringsFor({ mode: chat, runs: [grown], draft: "", busy: true })[0].used).toBe(10_000);
  });
  it("the denominator does not swing when the rotation lands on a bigger model", () => {
    let run = fold("r", use("browser-1", 1000, 100));
    const sizes: number[] = [];
    for (const [model, window] of [["nvidia/nemotron-3-ultra-550b-a55b:free", 1_000_000], ["openai/gpt-oss-20b", 131_072], ["nvidia/nemotron-3.5-lightning-30b-a3b", 262_144]] as const) {
      run = applyCEvent(run, { kind: "usage_live", agent: "browser-1", prompt: 1200, completion: 0, window, model, provider: "groq" });
      sizes.push(ringsFor({ mode: chat, runs: [run], draft: "", busy: true })[0].window);
    }
    expect(sizes).toEqual([131_072, 131_072, 131_072]);
  });
  it("a Pal's call counts on its own, even before UltraPal has made one", () => {
    const [r] = ringsFor({ mode: chat, runs: [fold("r", use("browser-1", 9000, 400))], draft: "", busy: false });
    expect(r).toMatchObject({ started: true, used: 9400 });
    expect(r.agents.map((a) => a.id)).toEqual(["browser-1"]);
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
describe("the ring moves while a call is still running", () => {
  const live = (prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage_live" }>> = {}): CEvent => ({ kind: "usage_live", agent: "main", prompt, completion, window: 262_144, model: "nvidia/nemotron-3-ultra-550b-a55b", provider: "bluesminds", ...o });
  it("shows the prompt as soon as the call starts, before a word has come back", () => {
    const [r] = ringsFor({ mode: chat, runs: [fold("r", live(2000, 0))], draft: "", busy: true });
    expect(r).toMatchObject({ used: 2000, window: 262_144, started: true, live: true, exact: false, calls: 0, model: "nvidia/nemotron-3-ultra-550b-a55b" });
  });
  it("grows with the reply, and the run total takes in only what the running call has spent so far", () => {
    const before = fold("r", use("main", 2000, 100));
    const [a] = ringsFor({ mode: chat, runs: [before], draft: "", busy: true });
    const [b] = ringsFor({ mode: chat, runs: [applyCEvent(before, live(2400, 90))], draft: "", busy: true });
    const [c] = ringsFor({ mode: chat, runs: [applyCEvent(before, live(2400, 400))], draft: "", busy: true });
    expect([a.used, b.used, c.used]).toEqual([2100, 2490, 2800]);
    expect(c.tokens).toBe(2100 + 2800);
    expect(c.live && b.live && !a.live).toBe(true);
  });
  it("is the exact figure again once the call has finished", () => {
    const run = fold("r", use("main", 2000, 100), live(2400, 400), use("main", 2410, 380));
    const [r] = ringsFor({ mode: chat, runs: [run], draft: "", busy: false });
    expect(r).toMatchObject({ used: 2790, live: false, exact: true, calls: 2 });
    expect(r.tokens).toBe(2100 + 2790);
  });
  it("a team in a Battle shows live too", () => {
    const run = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: live(1500, 120) });
    const rings = ringsFor({ mode: battle(2), runs: [run], draft: "", busy: true });
    expect(rings[0]).toMatchObject({ used: 1620, live: true });
    expect(rings[1].live).toBe(false);
  });
});
describe("a team's ring adds up that team's agents", () => {
  it("a Battle team counts its UltraPal and every Pal it sent out", () => {
    const run = arenaRun("battle", 2, 2,
      { kind: "contender", id: "c1", e: { kind: "agent", id: "browser-1", role: "browser", title: "BrowserPal", state: "running" } },
      { kind: "contender", id: "c1", e: use("main", 2000, 100) },
      { kind: "contender", id: "c1", e: use("browser-1", 5000, 200) },
      { kind: "contender", id: "c2", e: use("main", 1000, 50) },
    );
    const rings = ringsFor({ mode: battle(2), runs: [run], draft: "", busy: true });
    expect(rings[0]).toMatchObject({ used: 2100 + 5200, working: 1 });
    expect(rings[0].agents.map((a) => a.name)).toEqual(["UltraPal", "BrowserPal"]);
    expect(rings[1]).toMatchObject({ used: 1050 });
  });
  it("shows the judge and writer as a ring of its own once the contest itself has called a model", () => {
    const before = arenaRun("battle", 2, 2, { kind: "contender", id: "c1", e: use("main", 2000, 100) });
    expect(ringsFor({ mode: battle(2), runs: [before], draft: "", busy: true })).toHaveLength(2);
    const after = applyCEvent(before, use("main", 4000, 300));
    const rings = ringsFor({ mode: battle(2), runs: [after], draft: "", busy: false });
    expect(rings).toHaveLength(3);
    expect(rings[2]).toMatchObject({ key: "contest", label: "Judge and writer", used: 4300 });
    expect(rings[2].agents[0].name).toBe("Judge and writer");
  });
});

