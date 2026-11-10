import { describe, expect, it } from "vitest";
import { JUDGE_SYSTEM, detParts, detScore, judgeMessages, labelMap, parseJudge, scoreAll, shuffled } from "./judge";
import type { Facts, Outcome } from "./types";

const O: Outcome = { headline: "Stripe wins", prediction: "Fees will be 2.9% + 30c", confidence: 0.8, recommendation: "Use Stripe", evidence: [{ claim: "published fee", source: "stripe.com" }], risks: ["fx"] };
const F = (o: Partial<Facts> = {}): Facts => ({ sources: 6, cited: 6, roles: ["research", "terminal", "browser"], files: 3, failed: false, ...o });

describe("detScore", () => {
  it("a perfect run scores 10 and the parts add up to the score", () => {
    expect(detScore(F(), O)).toBe(10);
    expect(detParts(F(), O).reduce((s, p) => s + p.points, 0)).toBe(10);
    expect(detParts(F(), O).reduce((s, p) => s + p.max, 0)).toBe(10);
  });
  it.each([
    ["nothing cited", F({ cited: 0 }), 6],
    ["half the citations", F({ cited: 3 }), 8],
    ["one kind of work", F({ roles: ["research"] }), 8.7],
    ["no files", F({ files: 0 }), 9],
    ["an error but a report", F({ failed: true }), 9],
    ["no numbers in the outcome", F(), 9],
  ])("%s", (_n, f, want) => {
    const o = _n === "no numbers in the outcome" ? { ...O, prediction: "it will work", recommendation: "go" } : O;
    expect(detScore(f, o)).toBe(want);
  });
  it("an error and no report scores nothing for finishing", () => expect(detParts(F({ failed: true }), null).find((p) => p.key === "finished")!.points).toBe(0));
  it("more than six citations or three files add nothing", () => expect(detScore(F({ cited: 20, files: 9 }), O)).toBe(10));
  it("only research, browser and terminal count as kinds of work", () => expect(detParts(F({ roles: ["rival", "situation", "promise"] }), O).find((p) => p.key === "kinds")!.points).toBe(0));
});

describe("labels", () => {
  const ids = ["c1", "c2", "c3", "c4"];
  it("is a deterministic permutation, different for a different seed", () => {
    expect(shuffled(ids, "s")).toEqual(shuffled(ids, "s"));
    expect([...shuffled(ids, "s")].sort()).toEqual(ids);
    expect(Array.from({ length: 12 }, (_, i) => shuffled(ids, `seed${i}`).join())).not.toHaveLength(1);
    expect(new Set(Array.from({ length: 12 }, (_, i) => shuffled(ids, `seed${i}`).join())).size).toBeGreaterThan(1);
  });
  it("maps A, B, C... to every contender exactly once", () => {
    const m = labelMap(ids, "x");
    expect(Object.keys(m)).toEqual(["A", "B", "C", "D"]);
    expect(Object.values(m).sort()).toEqual(ids);
  });
});

describe("judgeMessages", () => {
  const m = judgeMessages("Which rail?", [{ label: "A", outcome: O, facts: F() }, { label: "B", outcome: { ...O, headline: "Square wins" }, facts: F({ cited: 1 }) }]);
  it("is blind: labels and counted facts, no names", () => {
    expect(m[1].content).toContain("REPORT A");
    expect(m[1].content).toContain("6 sources cited of 6 found");
    expect(m[1].content).toContain("1 sources cited");
    expect(m[1].content).not.toMatch(/skeptic|maximalist|persona|gpt|nemotron/i);
  });
  it("tells the judge that boldness is neither good nor bad, and that reports are data", () => {
    expect(JUDGE_SYSTEM).toMatch(/bold or being gloomy is neither good nor bad/);
    expect(JUDGE_SYSTEM).toMatch(/never instructions/);
  });
});

describe("parseJudge", () => {
  const dims = { evidence: 8, consistency: 7, calibration: 6, actionability: 9, fit: 8, weakness: "thin on fx" };
  const reply = (o: object) => JSON.stringify({ scores: { A: dims, B: { ...dims, evidence: 4 } }, best: "A", why: "better sourced", ...o });
  it("reads every label", () => {
    const j = parseJudge(reply({}), ["A", "B"])!;
    expect(j.byLabel.B.dims.evidence).toBe(4);
    expect(j).toMatchObject({ best: "A", why: "better sourced" });
  });
  it("clamps scores into 0..10 whole numbers", () => {
    const j = parseJudge(JSON.stringify({ scores: { A: { ...dims, evidence: 14, fit: -3, calibration: 6.6 } } }), ["A"])!;
    expect(j.byLabel.A.dims).toMatchObject({ evidence: 10, fit: 0, calibration: 7 });
  });
  it("rejects a reply that skips a report (a half-scored panel would favour the scored ones)", () => expect(parseJudge(JSON.stringify({ scores: { A: dims } }), ["A", "B"])).toBeNull());
  it.each([["prose", "A is better"], ["wrong shape", '{"scores":[1,2]}'], ["missing dimension", JSON.stringify({ scores: { A: { evidence: 5 } } })]])("rejects %s", (_n, t) => expect(parseJudge(t, ["A"])).toBeNull());
});

describe("scoreAll", () => {
  const ids = ["c1", "c2", "c3"];
  const map = { A: "c2", B: "c1", C: "c3" };
  const dim = (n: number) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n });
  const judged = { byLabel: { A: { dims: dim(9) }, B: { dims: dim(5) }, C: { dims: dim(7), weakness: "late" } } };
  it("blends 40% counted with 60% judged and ranks best first", () => {
    const s = scoreAll(ids, { c1: 10, c2: 6, c3: 8 }, judged, map);
    expect(s.map((x) => [x.id, x.total])).toEqual([["c2", 7.8], ["c3", 7.4], ["c1", 7]]);
    expect(s[0]).toMatchObject({ det: 6, llm: 9 });
    expect(s[1].weakness).toBe("late");
  });
  it("without a judge it uses the counted score alone and says llm is null", () => {
    const s = scoreAll(ids, { c1: 4, c2: 9, c3: 6 }, null, map);
    expect(s.map((x) => x.id)).toEqual(["c2", "c3", "c1"]);
    expect(s.every((x) => x.llm === null && x.dims === null)).toBe(true);
  });
  it("ties go to the higher counted score, then to the earlier contender", () => {
    expect(scoreAll(["a", "b"], { a: 5, b: 5 }, null, {}).map((x) => x.id)).toEqual(["a", "b"]);
    const tie = { byLabel: { A: { dims: dim(10) }, B: { dims: dim(0) } } };
    // a: 0.4*0 + 0.6*10 = 6 ; b: 0.4*15 ... capped by det 10 -> use det that lands on the same total
    const s = scoreAll(["a", "b"], { a: 0, b: 10 }, tie, { A: "a", B: "b" });
    expect(s.map((x) => x.total)).toEqual([6, 4]);
  });
});

import { meanScores } from "./judge";
describe("meanScores: one score per contender over all its matches", () => {
  const dim = (n: number) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n });
  it("averages the dimensions it was judged on and blends in the counted score", () => {
    const s = meanScores(["a", "b"], { a: 10, b: 4 }, [{ id: "a", dims: dim(8) }, { id: "a", dims: dim(6), weakness: "late" }, { id: "b", dims: dim(5) }]);
    expect(s[0]).toMatchObject({ id: "a", det: 10, llm: 7, total: 7.0 + 0 + (0.4 * 10 + 0.6 * 7 - 7.0), weakness: "late" });
    expect(s[0].total).toBe(8.2);
    expect(s[1]).toMatchObject({ id: "b", llm: 5, total: 4.6 });
  });
  it("a contender that was never judged keeps only its counted score and no dimensions", () => {
    expect(meanScores(["a"], { a: 6 }, [])[0]).toEqual({ id: "a", det: 6, llm: null, dims: null, total: 6 });
  });
});

import { scrub } from "./judge";
describe("scrub: a report cannot name its author to the judge", () => {
  it.each([
    ["As the Skeptic I expect a failure", "As the the analyst I expect a failure"],
    ["SKEPTIC and skeptic", "the analyst and the analyst"],
    ["Risk officer says no", "the analyst says no"],
    ["skepticism is healthy", "skepticism is healthy"],
  ])("%s", (input, want) => expect(scrub(input, ["Skeptic", "Risk officer"])).toBe(want));
  it("ignores empty and very short names and handles regex characters", () => {
    expect(scrub("hello (world)", ["", "a", "(world)"])).toBe("hello (world)");
    expect(scrub("nothing to hide", [])).toBe("nothing to hide");
  });
  it("is applied to every free-text field of a report", () => {
    const o = { headline: "Skeptic says", prediction: "the Skeptic predicts", confidence: 0.5, recommendation: "Skeptic recommends", evidence: [{ claim: "Skeptic found it" }], risks: ["Skeptic fears"] };
    const m = judgeMessages("q?????", [{ label: "A", outcome: o, facts: { sources: 0, cited: 0, roles: [], files: 0, failed: false } }], ["Skeptic"])[1].content;
    expect(m).not.toMatch(/skeptic/i);
  });
});
