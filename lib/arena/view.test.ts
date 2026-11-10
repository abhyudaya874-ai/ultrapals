import { describe, expect, it } from "vitest";
import type { CEvent } from "@/lib/computer/events";
import { applyCEvent, newRun } from "@/lib/computer/run";
import { defaultPlan } from "./plan";
import { buildBracket } from "./bracket";
import { entriesOf, evidenceLines, pathOf, placeOf, progressOf, roundViews, splitFinal, statusText, toEntry } from "./view";
import type { ContenderInfo, Facts, Outcome, Score } from "./types";

const facts: Facts = { sources: 3, cited: 2, roles: ["research"], files: 1, failed: false };
const out = (p: string, ev: Outcome["evidence"] = []): Outcome => ({ headline: p, prediction: p, confidence: 0.7, recommendation: "go", evidence: ev, risks: [] });
const info = (id: string, name: string, over: Partial<ContenderInfo> = {}): ContenderInfo => ({ id, name, persona: "p", stance: "s", tool: "research", ...over });
const score = (id: string, total: number, d = total): Score => ({ id, det: 3, llm: d, dims: { evidence: d, consistency: d, calibration: d, actionability: d, fit: d }, total });
const reduce = (ev: CEvent[]) => ev.reduce(applyCEvent, newRun("r", "p")).arena!;

describe("entriesOf / toEntry", () => {
  const a = reduce([
    { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 2, adaptive: false, contenders: [info("a", "Alpha"), info("b", "Beta")] },
    { kind: "contender_done", id: "a", outcome: out("A"), facts, ok: true },
    { kind: "contender_done", id: "b", outcome: out("B"), facts, ok: true },
    { kind: "arena_scores", scores: [score("b", 7), score("a", 5)], winner: "b", judge: "x" },
  ]);
  it("only scored contenders become entries, with their own sources", () => {
    expect(entriesOf(a).map((e) => e.id)).toEqual(["a", "b"]);
    expect(toEntry({ ...a.contenders[0], score: undefined })).toBeNull();
  });
});

describe("roundViews", () => {
  const rounds = (): CEvent[] => [
    { kind: "arena", mode: "loop", plan: "auto", scenario: "s", question: "q", max: 4, adaptive: true, contenders: [] },
    { kind: "contender_add", info: info("r1", "Round 1: Base case", { round: 1, scenarioName: "Base case" }) },
    { kind: "contender_done", id: "r1", outcome: out("Fees near 12 percent"), facts, ok: true },
    { kind: "arena_scores", scores: [score("r1", 3, 3)], winner: "r1", judge: null, round: 1 },
    { kind: "contender_add", info: info("r2", "Round 2: Worst case", { round: 2, scenarioName: "Worst case", beat: { headline: "Fees near 12 percent", weakness: "ignores fx costs", score: 3 } }) },
    { kind: "contender_done", id: "r2", outcome: out("Fees rise once fx costs are included"), facts, ok: true },
    { kind: "arena_scores", scores: [score("r2", 6, 7), score("r1", 3, 3)], winner: "r2", judge: "x", round: 2 },
  ];
  it("lists rounds in order, each with what changed from the one before", () => {
    const v = roundViews(reduce(rounds()));
    expect(v.map((x) => [x.round, x.best, x.diff === null])).toEqual([[1, false, true], [2, true, false]]);
    expect(v[1].diff).toMatchObject({ scenario: { from: "Base case", to: "Worst case" }, score: { from: 3, to: 6, delta: 3 } });
    expect(v[1].diff!.targeted).toMatchObject({ weakness: "ignores fx costs", addressed: true });
  });
  it("a round still running has no entry and no diff", () => {
    const v = roundViews(reduce([...rounds(), { kind: "contender_add", info: info("r3", "Round 3: X", { round: 3, scenarioName: "X" }) }]));
    expect(v[2]).toMatchObject({ round: 3, entry: null, diff: null, best: false });
  });
  it("a planned round learns what to beat without being added twice", () => {
    const a = reduce([
      { kind: "arena", mode: "loop", plan: "manual", scenario: "s", question: "q", max: 2, adaptive: false, contenders: [info("r1", "Round 1", { round: 1 }), info("r2", "Round 2", { round: 2 })] },
      { kind: "contender_add", info: info("r2", "Round 2", { round: 2, beat: { headline: "h", score: 4 } }) },
    ]);
    expect(a.contenders).toHaveLength(2);
    expect(a.contenders[1].info.beat).toEqual({ headline: "h", score: 4 });
    expect(a.contenders[1].state).toBe("pending");
  });
});

describe("progressOf", () => {
  const base: CEvent = { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 3, adaptive: false, contenders: [info("a", "A"), info("b", "B"), info("c", "C")] };
  it("counts finished teams while running", () => {
    const a = reduce([base, { kind: "contender_done", id: "a", outcome: null, facts, ok: true }]);
    expect(progressOf(a)).toEqual({ done: 1, total: 3, text: "1 of 3 teams finished" });
  });
  it("describes the later phases", () => {
    expect(progressOf(reduce([base, { kind: "arena_phase", phase: "writing" }])).text).toBe("Writing the combined outcome");
    expect(progressOf(reduce([base, { kind: "arena_phase", phase: "done" }])).text).toBe("Finished without a result");
  });
  it("an adaptive loop counts the rounds it may still run", () => {
    const a = reduce([{ ...base, mode: "loop", adaptive: true, max: 5, contenders: [] } as CEvent, { kind: "contender_add", info: info("r1", "R1", { round: 1 }) }]);
    expect(progressOf(a)).toMatchObject({ done: 0, total: 5, text: "0 of 5 rounds finished" });
  });
});

describe("placeOf", () => {
  const ids = ["a", "b", "c", "d"];
  const bracket = buildBracket(ids, "s");
  const m = (id: string, label: string, round: number, a: string, b: string, winner: string) => ({ id, label, round, a, b, winner, loser: winner === a ? b : a, bye: false, duel: null, why: null, judged: true, hpAfter: null, hpNext: null });
  const [s1a, s1b] = [bracket.rounds[0][0].a.id!, bracket.rounds[0][0].b.id!];
  const [s2a, s2b] = [bracket.rounds[0][1].a.id!, bracket.rounds[0][1].b.id!];
  const state = reduce([
    { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 4, adaptive: false, contenders: ids.map((i) => info(i, i)), bracket },
    { kind: "arena_match", match: m("r1m1", "Semi-final", 1, s1a, s1b, s1a) },
    { kind: "arena_match", match: m("r1m2", "Semi-final", 1, s2a, s2b, s2a) },
    { kind: "arena_match", match: m("third", "Third place", 2, s1b, s2b, s2b) },
    { kind: "arena_match", match: m("r2m1", "Final", 2, s1a, s2a, s1a) },
    { kind: "arena_final", final: { winner: s1a, text: "t", provenance: [], why: "", judge: null } },
  ]);
  it("names every place once the contest is over", () => {
    expect(placeOf(state, s1a)).toBe("Champion");
    expect(placeOf(state, s2a)).toBe("Runner-up");
    expect(placeOf(state, s2b)).toBe("Third");
    expect(placeOf(state, s1b)).toBe("Fourth");
  });
  it("is null while the contest is still on", () => expect(placeOf({ ...state, final: undefined }, s1a)).toBeNull());
  it("is defaultPlan-independent: only matches and the final matter", () => expect(defaultPlan("battle", 4, { question: "Will it work?" }).slots).toHaveLength(4));
});

describe("statusText", () => {
  const start: CEvent = { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 1, adaptive: false, contenders: [info("a", "A")] };
  const wrap = (e: CEvent): CEvent => ({ kind: "contender", id: "a", e });
  const c = (...ev: CEvent[]) => reduce([start, ...ev]).contenders[0];
  it("waits until it has a turn", () => expect(statusText(c())).toBe("Waiting for a turn"));
  it("names the step that is running", () => {
    expect(statusText(c(wrap({ kind: "agent", id: "research-1", role: "research", title: "ResearchPal", state: "running" }), wrap({ kind: "step", agent: "research-1", id: "s", label: "Searching the web", state: "running" })))).toBe("Searching the web");
  });
  it("says it is writing once the answer streams", () => expect(statusText(c(wrap({ kind: "answer", delta: "Fees" })))).toBe("Writing its report"));
  it("reports the score when it is done, and a stop when it failed", () => {
    expect(statusText(c(wrap({ kind: "answer", delta: "x" }), { kind: "contender_done", id: "a", outcome: null, facts, ok: true }, { kind: "arena_scores", scores: [score("a", 7.5)], winner: "a", judge: null }))).toBe("Scored 7.5 out of 10");
    expect(statusText(c({ kind: "contender_done", id: "a", outcome: null, facts, ok: false }))).toBe("Stopped early");
  });
});

describe("splitFinal", () => {
  it("splits the combined outcome under its headings and keeps list lines", () => {
    const parts = splitFinal("BEST OUTCOME: go with option 2.\nWHY IT WON: best sourced.\nWHAT THE OTHERS GOT RIGHT:\n- (Skeptic) fx can double the cost\n- (Risk officer) chargebacks\nWATCH OUT FOR: fx.");
    expect(parts.map((p) => p.title)).toEqual(["Best outcome", "Why it won", "What the others got right", "Watch out for"]);
    expect(parts[0].lines).toEqual(["go with option 2."]);
    expect(parts[2].lines).toEqual(["- (Skeptic) fx can double the cost", "- (Risk officer) chargebacks"]);
  });
  it("text with no headings is one part with no title", () => expect(splitFinal("Just a sentence.\nAnd another.")).toEqual([{ title: null, lines: ["Just a sentence.", "And another."] }]));
  it("empty text has no parts, and headings are found in any case", () => {
    expect(splitFinal("  \n ")).toEqual([]);
    expect(splitFinal("best outcome: x")[0]).toEqual({ title: "Best outcome", lines: ["x"] });
  });
});

describe("evidenceLines", () => {
  const c = reduce([
    { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 1, adaptive: false, contenders: [info("a", "A")] },
    { kind: "contender", id: "a", e: { kind: "sources", sources: [{ n: 1, url: "https://stripe.com/pricing", title: "Pricing", snippet: "2.9%", host: "stripe.com", publishedDate: null, provider: "tavily", score: null }] } },
    { kind: "contender_done", id: "a", outcome: out("x", [{ claim: "fee page", source: "stripe.com" }, { claim: "by number", source: "[1]" }, { claim: "elsewhere", source: "wise.com" }, { claim: "no source" }]), facts, ok: true },
  ]).contenders[0];
  it("ties each claim to the source it named, with its number when the contender found that site", () => {
    expect(evidenceLines(c)).toEqual([
      { claim: "fee page", source: "stripe.com", host: "stripe.com", n: 1 },
      { claim: "by number", source: "[1]", host: "stripe.com", n: 1 },
      { claim: "elsewhere", source: "wise.com", host: "wise.com", n: null },
      { claim: "no source", source: null, host: null, n: null },
    ]);
  });
});

describe("pathOf", () => {
  const m = (id: string, label: string, round: number, a: string, b: string, winner: string, ko = false) => ({ id, label, round, a, b, winner, loser: winner === a ? b : a, bye: false, duel: ko ? ({ ko: true } as never) : null, why: null, judged: true, hpAfter: { a: 70, b: 30 }, hpNext: 80 });
  const a = reduce([
    { kind: "arena", mode: "battle", plan: "auto", scenario: "s", question: "q", max: 3, adaptive: false, contenders: [info("a", "Alpha"), info("b", "Beta"), info("c", "Gamma")] },
    { kind: "arena_match", match: m("r2m1", "Final", 2, "a", "c", "a", true) },
    { kind: "arena_match", match: m("r1m1", "Semi-final", 1, "a", "b", "a") },
  ]);
  it("lists what the contender won, earliest first, with who it beat and its health", () => {
    expect(pathOf(a, "a")).toEqual([{ label: "Semi-final", opponent: "Beta", hp: 70, ko: false }, { label: "Final", opponent: "Gamma", hp: 70, ko: true }]);
  });
  it("is empty for a contender that won nothing", () => expect(pathOf(a, "b")).toEqual([]));
});
