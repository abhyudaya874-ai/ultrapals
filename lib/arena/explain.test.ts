import { describe, expect, it } from "vitest";
import { calibrationPoints, detBreakdown, dimGrid, evidenceMatrix, hostOfSource, loopCurve, ordinal, unjudgedNote, whyBullets, winnerEdge, type Entry } from "./explain";
import { detScore } from "./judge";
import type { Facts, Outcome, Score } from "./types";

const dims = (n: number, over: Partial<Score["dims"] & object> = {}) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n, ...over });
const out = (headline: string, evidence: Outcome["evidence"], confidence = 0.7): Outcome => ({ headline, prediction: "2.9% fee", confidence, recommendation: "go with 2", evidence, risks: [] });
const facts = (cited: number, roles = ["research"]): Facts => ({ sources: cited + 2, cited, roles, files: 1, failed: false });
function entry(id: string, name: string, total: number, d: number | null, o: Outcome, f: Facts, srcs: Entry["sources"] = [], over: Partial<Score> = {}): Entry {
  return { id, name, outcome: o, facts: f, sources: srcs, score: { id, det: detScore(f, o), llm: d, dims: d === null ? null : dims(d), total, ...over } };
}
const A = entry("a", "Rigorist", 8.4, 9, out("Stripe", [{ claim: "published fee", source: "stripe.com" }, { claim: "tax", source: "[2]" }]), facts(5, ["research", "terminal", "browser"]), [{ n: 1, host: "stripe.com" }, { n: 2, host: "docs.stripe.com" }]);
const B = entry("b", "Skeptic", 7.1, 7, out("Square", [{ claim: "fee", source: "squareup.com/us" }, { claim: "published fee", source: "https://www.stripe.com/pricing" }]), facts(2), [{ n: 1, host: "squareup.com" }]);
const C = entry("c", "Maximalist", 5.2, 5, out("PayPal", [{ claim: "unsourced" }]), facts(0));
const ALL = [A, B, C];

describe("winnerEdge", () => {
  it("compares the winner with the average of the others, biggest advantage first", () => {
    const e = winnerEdge(ALL, "a");
    expect(e).toHaveLength(5);
    expect(e[0]).toMatchObject({ winner: 9, others: 6, delta: 3, leads: true });
  });
  it("marks a dimension the winner did not lead", () => {
    const x = { ...B, score: { ...B.score, dims: dims(7, { calibration: 10 }) } };
    expect(winnerEdge([A, x, C], "a").find((e) => e.dim === "calibration")).toMatchObject({ leads: false });
  });
  it("without a judge there is nothing to compare", () => expect(winnerEdge([{ ...A, score: { ...A.score, dims: null } }, B], "a")).toEqual([]));
  it("an unknown winner gives nothing", () => expect(winnerEdge(ALL, "zzz")).toEqual([]));
});

describe("dimGrid / detBreakdown / calibration", () => {
  it("scales dimensions to 0..1 per contender, null without a judge", () => {
    const g = dimGrid([A, { ...C, score: { ...C.score, dims: null } }]);
    expect(g.rows).toEqual(["Rigorist", "Maximalist"]);
    expect(g.values[0]).toEqual([0.9, 0.9, 0.9, 0.9, 0.9]);
    expect(g.values[1]).toEqual([null, null, null, null, null]);
  });
  it("the counted breakdown adds up to the counted score", () => {
    for (const e of ALL) expect(Math.round(detBreakdown(e).reduce((s, p) => s + p.points, 0) * 10) / 10).toBe(e.score.det);
  });
  it("confidence against score, as percent", () => expect(calibrationPoints(ALL)[0]).toEqual({ id: "a", name: "Rigorist", confidence: 70, total: 8.4 }));
});

describe("evidence", () => {
  it.each([["stripe.com", "stripe.com"], ["https://www.stripe.com/pricing", "stripe.com"], ["squareup.com/us", "squareup.com"], ["[2]", "docs.stripe.com"], ["2", "docs.stripe.com"], ["[9]", null], ["see the page", null], [undefined, null]])("hostOfSource(%s)", (s, want) => {
    expect(hostOfSource(s as string | undefined, A.sources)).toBe(want);
  });
  it("finds sites cited by more than one contender, most shared first", () => {
    const m = evidenceMatrix(ALL);
    expect(m[0]).toEqual({ host: "stripe.com", by: ["a", "b"] });
    expect(m.map((x) => x.host)).toEqual(["stripe.com", "docs.stripe.com", "squareup.com"]);
  });
  it("one contender citing a site twice counts once", () => {
    const twice = entry("d", "X", 1, null, out("h", [{ claim: "a", source: "x.test" }, { claim: "b", source: "x.test" }]), facts(1));
    expect(evidenceMatrix([twice])).toEqual([{ host: "x.test", by: ["d"] }]);
  });
});

describe("whyBullets: every sentence is true of the data", () => {
  const b = whyBullets(ALL, "a", "better sourced");
  it("states the margin, the dimensions it led, the citations and the tools", () => {
    expect(b[0]).toBe("Highest total score, 8.4 out of 10, 1.3 ahead of Skeptic (7.1).");
    expect(b.join("\n")).toMatch(/Led on evidence \(9 against an average of 6\)/);
    expect(b.join("\n")).toContain("Cited 5 sources; the others cited 1 on average.");
    expect(b.join("\n")).toContain("Used research, terminal, browser to check its claims.");
    expect(b.at(-1)).toBe("The blind judge's reason: better sourced");
  });
  it("names the weakest point only when it is below 8", () => {
    expect(b.join("\n")).not.toMatch(/weakest point/);
    const weak = { ...A, score: { ...A.score, dims: dims(9, { calibration: 5 }), weakness: "overconfident" } };
    expect(whyBullets([weak, B, C], "a").join("\n")).toContain("Its weakest point was calibration (5/10): overconfident");
  });
  it("does not claim more citations when the winner did not cite more", () => {
    const fewer = entry("a", "Rigorist", 8.4, 9, A.outcome!, facts(1), A.sources);
    expect(whyBullets([fewer, B, C], "a").join("\n")).not.toMatch(/Cited/);
  });
  it("says so when there was no judge", () => {
    const nj = ALL.map((e) => ({ ...e, score: { ...e.score, dims: null, llm: null } }));
    expect(whyBullets(nj, "a").join("\n")).toContain("No judge answered");
  });
  it("a knockout champion with a lower average says it won head to head, not on average", () => {
    const upset = [{ ...A, score: { ...A.score, total: 6 } }, B, C];
    const first = whyBullets(upset, "a")[0];
    expect(first).toBe("Won the knockout on head-to-head results. Its average score, 6 out of 10, was 2nd of 3: each match is decided by the two reports side by side, not by the average.");
    expect(first).not.toMatch(/Highest total/);
  });
  it("a tie is reported as a tie", () => {
    const t = [{ ...A, score: { ...A.score, total: 7 } }, { ...B, score: { ...B.score, total: 7 } }];
    expect(whyBullets(t, "a")[0]).toContain("Tied on total score with Skeptic");
  });
});

describe("loopCurve", () => {
  it("tracks the best total so far per round", () => {
    const rounds = [entry("r1", "Round 1", 5, 5, A.outcome!, facts(1)), entry("r2", "Round 2", 7, 7, A.outcome!, facts(1)), entry("r3", "Round 3", 6, 6, A.outcome!, facts(1))];
    expect(loopCurve(rounds)).toEqual([{ round: 1, score: 5, best: 5 }, { round: 2, score: 7, best: 7 }, { round: 3, score: 6, best: 7 }]);
  });
});

describe("ordinal", () => {
  it.each([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [101, "101st"], [111, "111th"]])("%i", (n, want) => expect(ordinal(n)).toBe(want));
});

describe("unjudgedNote", () => {
  it("a judged match credits the blind judge and its reason", () => {
    expect(unjudgedNote({ judged: true, judgeWhy: "better sourced" })).toBe("Scored side by side by a blind judge: better sourced");
    expect(unjudgedNote({ judged: true })).toBe("Scored side by side by a blind judge.");
  });
  it("says when a team had no report, which is not the same as the judge failing", () => {
    expect(unjudgedNote({ judged: false, unjudged: "no_report" })).toMatch(/did not finish a report.*nothing for the judge to compare/);
    expect(unjudgedNote({ judged: false, unjudged: "no_judge" })).toMatch(/^No judge answered/);
    expect(unjudgedNote({ judged: false })).toMatch(/^No judge answered/);
  });
});
