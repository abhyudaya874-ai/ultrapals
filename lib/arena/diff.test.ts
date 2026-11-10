import { describe, expect, it } from "vitest";
import { overlap, roundDiff, sitesOf, stability, tokens } from "./diff";
import type { Entry } from "./explain";
import type { Outcome, Score } from "./types";

const out = (prediction: string, o: Partial<Outcome> = {}): Outcome => ({ headline: "Headline", prediction, confidence: 0.7, recommendation: "go with option two", evidence: [], risks: [], ...o });
const dims = (n: number, over: Partial<Record<string, number>> = {}) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n, ...over }) as Score["dims"];
function entry(id: string, name: string, total: number, d: number | null, o: Outcome | null, sources: Entry["sources"] = [], over: Partial<Score> = {}): Entry {
  return { id, name, outcome: o, facts: null, sources, score: { id, det: 3, llm: d, dims: d === null ? null : dims(d), total, ...over } };
}

describe("tokens / overlap", () => {
  it("keeps words that carry meaning and numbers, drops filler and short words", () => {
    expect([...tokens("The fee is about 2.9% and 30 cents, for the card")].sort()).toEqual(["2.9%", "30", "card", "cents", "fee"].sort());
  });
  it("is the share of words in common", () => {
    expect(overlap("fees near 12 percent", "fees near 12 percent")).toBe(1);
    expect(overlap("fees near 12 percent", "volume doubles quickly")).toBe(0);
    expect(overlap("fees near 12 percent", "fees near 15 percent")).toBeCloseTo(3 / 5, 5);
  });
  it("two empty texts share nothing", () => expect(overlap("", "the and")).toBe(0));
});

describe("sitesOf", () => {
  it("lists the sites an outcome cites, once each, using the numbered sources for [n]", () => {
    const e = entry("a", "A", 5, 5, out("x", { evidence: [{ claim: "c", source: "stripe.com" }, { claim: "d", source: "[1]" }, { claim: "e", source: "https://www.square.test/a" }, { claim: "f" }] }), [{ n: 1, host: "stripe.com" }]);
    expect(sitesOf(e)).toEqual(["stripe.com", "square.test"]);
    expect(sitesOf(null)).toEqual([]);
  });
});

describe("roundDiff", () => {
  const prev = entry("r1", "Round 1", 5.4, 6, out("Fees stay near 12 percent for cards", { confidence: 0.8, evidence: [{ claim: "published fee", source: "stripe.com" }, { claim: "tax", source: "irs.gov" }] }), [], { weakness: "ignores currency conversion costs" });
  const cur = entry("r2", "Round 2", 6.6, 8, out("Fees climb to 15 percent once currency conversion is included", { confidence: 0.6, evidence: [{ claim: "fx fee", source: "wise.com" }, { claim: "published fee", source: "stripe.com" }] }));
  const d = roundDiff({ ...prev, score: { ...prev.score, dims: dims(6, { evidence: 4 }) } }, { ...cur, score: { ...cur.score, dims: dims(8, { evidence: 9 }) } }, { scenarioFrom: "Base case", scenarioTo: "Worst case", weakness: prev.score.weakness });
  it("compares scores and every dimension, biggest gain first", () => {
    expect(d.score).toEqual({ from: 5.4, to: 6.6, delta: 1.2 });
    expect(d.dims[0]).toEqual({ dim: "evidence", from: 4, to: 9, delta: 5 });
    expect(d.dims).toHaveLength(5);
  });
  it("reports confidence and whether the prediction changed its mind", () => {
    expect(d.confidence).toEqual({ from: 80, to: 60 });
    expect(d.predictionChanged).toBe(true);
    expect(d.predictionOverlap).toBeLessThan(0.6);
  });
  it("lists the sites added, dropped and kept", () => expect(d.sites).toEqual({ added: ["wise.com"], dropped: ["irs.gov"], kept: ["stripe.com"] }));
  it("says whether the report now talks about what the best round lacked, by words", () => {
    expect(d.targeted?.weakness).toBe("ignores currency conversion costs");
    expect(d.targeted?.matched).toEqual(expect.arrayContaining(["currency", "conversion"]));
    expect(d.targeted?.addressed).toBe(true);
  });
  it("a report that does not mention it is not claimed to have addressed it", () => {
    const x = roundDiff(prev, entry("r2", "Round 2", 6, 6, out("Nothing relevant here at all")), { scenarioFrom: null, scenarioTo: "Other", weakness: "ignores currency conversion costs" });
    expect(x.targeted).toMatchObject({ addressed: false, matched: [] });
  });
  it("the first round has nothing to compare with", () => {
    const first = roundDiff(null, cur, { scenarioFrom: null, scenarioTo: "Base case" });
    expect(first.score).toEqual({ from: null, to: 6.6, delta: null });
    expect(first.confidence).toBeNull();
    expect(first.predictionChanged).toBe(false);
    expect(first.sites.added).toEqual(["wise.com", "stripe.com"]);
    expect(first.targeted).toBeNull();
  });
  it("a round the judge did not score has no dimension deltas", () => {
    const nj = roundDiff(prev, entry("r2", "Round 2", 4, null, out("x y z")), { scenarioFrom: null, scenarioTo: "T" });
    expect(nj.dims.every((x) => x.delta === null)).toBe(true);
  });
  it("same prediction in other words is not a change of mind", () => {
    const same = roundDiff(prev, entry("r2", "Round 2", 6, 6, out("Fees stay near 12 percent for cards, roughly")), { scenarioFrom: null, scenarioTo: "T" });
    expect(same.predictionChanged).toBe(false);
  });
});

describe("stability", () => {
  const w = entry("w", "Round 3", 8, 8, out("Fees stay near 12 percent for card payments"));
  it("counts the scenarios where the winner's prediction held", () => {
    const s = stability([entry("a", "Round 1", 5, 5, out("Fees stay near 12 percent for card payments in the base case")), w, entry("b", "Round 2", 6, 6, out("Volume doubles within a year")), entry("c", "Round 4", 7, 7, out("Card payment fees near 12 percent"))], "w");
    expect(s).toMatchObject({ held: 2, of: 3 });
    expect(s!.rows.map((r) => [r.name, r.held])).toEqual([["Round 1", true], ["Round 2", false], ["Round 4", true]]);
  });
  it("needs a winner with an outcome and at least one other report", () => {
    expect(stability([w], "w")).toBeNull();
    expect(stability([w, entry("a", "A", 5, 5, null)], "w")).toBeNull();
    expect(stability([w], "zzz")).toBeNull();
  });
});
