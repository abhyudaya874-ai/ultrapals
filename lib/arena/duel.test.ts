import { describe, expect, it } from "vitest";
import { ARMOR_MAX, DIM_WEIGHT, MAX_HP, RECOVER, armor, duel, recover, whyResult, type Fighter } from "./duel";
import { DIMENSIONS, type Dim, type Facts } from "./types";

const facts = (cited: number): Facts => ({ sources: cited, cited, roles: ["research"], files: 0, failed: false });
const dims = (n: number, over: Partial<Record<Dim, number>> = {}): Record<Dim, number> => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n, ...over });
const F = (id: string, d: Record<Dim, number> | null, o: Partial<Fighter> = {}): Fighter => ({ id, hp: MAX_HP, dims: d, det: 5, facts: facts(0), ...o });

describe("the numbers", () => {
  it("the weights add to 12 and evidence hits hardest", () => {
    expect(DIMENSIONS.reduce((s, d) => s + DIM_WEIGHT[d], 0)).toBe(12);
    expect(DIM_WEIGHT.evidence).toBe(Math.max(...Object.values(DIM_WEIGHT)));
  });
  it.each([[0, 0], [1, 0.03], [3, 0.09], [6, 0.18], [20, ARMOR_MAX]])("%i cited sources -> %f armour", (n, a) => expect(armor(facts(n))).toBeCloseTo(a));
  it("no facts, no armour", () => expect(armor(null)).toBe(0));
});

describe("duel", () => {
  it("the higher score lands a hit worth the gap times the weight", () => {
    const r = duel(F("a", dims(5, { evidence: 9 })), F("b", dims(5)));
    expect(r.hits).toEqual([{ dim: "evidence", by: "a", scoreA: 9, scoreB: 5, gap: 4, raw: 12, dealt: 12 }]);
    expect(r.hp).toEqual({ a: 100, b: 88 });
    expect(r.winner).toBe("a");
    expect(r.ko).toBe(false);
    expect(r.decidedBy).toBe("health");
  });
  it("both sides can land hits; more health left wins", () => {
    const r = duel(F("a", dims(5, { evidence: 8, fit: 3 })), F("b", dims(5, { evidence: 5, fit: 8, calibration: 6 })));
    expect(r.taken).toEqual({ a: 2 * 5 + 2.5 * 1, b: 3 * 3 });
    expect(r.hp).toEqual({ a: 87.5, b: 91 });
    expect(r.winner).toBe("b"); // it took less damage in total, even though a won the heaviest dimension
  });
  it("cited sources are armour: the same hit does less", () => {
    const plain = duel(F("a", dims(8)), F("b", dims(4)));
    const armoured = duel(F("a", dims(8)), F("b", dims(4), { facts: facts(6) }));
    expect(armoured.taken.b).toBeLessThan(plain.taken.b);
    expect(armoured.taken.b).toBeCloseTo(plain.taken.b * (1 - ARMOR_MAX), 0);
  });
  it("a sweep knocks the loser out, and a KO is labelled", () => {
    const r = duel(F("a", dims(10)), F("b", dims(0)));
    expect(r.hp.b).toBe(0);
    expect(r.ko).toBe(true);
    expect(r.decidedBy).toBe("ko");
    expect(r.winner).toBe("a");
  });
  it("health carries between rounds: a hurt fighter loses a match it would otherwise win", () => {
    const r = duel(F("a", dims(6), { hp: 20 }), F("b", dims(5)));
    expect(r.winner).toBe("b");
    expect(r.from.a).toBe(20);
  });
  it("level scores are decided by the counted score, then by seed", () => {
    expect(duel(F("a", dims(5), { det: 4 }), F("b", dims(5), { det: 7 }))).toMatchObject({ winner: "b", decidedBy: "counted", hits: [] });
    expect(duel(F("a", dims(5)), F("b", dims(5)))).toMatchObject({ winner: "a", decidedBy: "seed" });
  });
  it("with no judge the counted score stands in for every dimension", () => {
    const r = duel(F("a", null, { det: 8 }), F("b", null, { det: 5 }));
    expect(r.hits).toHaveLength(5);
    expect(r.hits.every((h) => h.gap === 3 && h.by === "a")).toBe(true);
    expect(r.winner).toBe("a");
  });
  it("health never goes below zero or above the maximum", () => {
    const r = duel(F("a", dims(10)), F("b", dims(0), { hp: 5 }));
    expect(r.hp.b).toBe(0);
    expect(r.hp.a).toBeLessThanOrEqual(MAX_HP);
  });
  it("is symmetric: swapping the sides swaps the result", () => {
    const x = duel(F("a", dims(7, { evidence: 9 })), F("b", dims(5)));
    const y = duel(F("b", dims(5)), F("a", dims(7, { evidence: 9 })));
    expect(x.hp.a).toBe(y.hp.b);
    expect(x.hp.b).toBe(y.hp.a);
    expect(x.winner === "a").toBe(y.winner === "b");
  });
});

describe("recover", () => {
  it("gives back a share of what was lost, never more than the maximum", () => {
    expect(recover(40)).toBe(40 + 60 * RECOVER);
    expect(recover(100)).toBe(100);
    expect(recover(0)).toBe(RECOVER * 100);
  });
});

describe("whyResult: words come from the numbers", () => {
  const names = { a: "Rigorist", b: "Skeptic" };
  it("says who hit hardest on what, and what cost the loser", () => {
    const r = duel(F("a", dims(5, { evidence: 9, fit: 7 }), { facts: facts(4) }), F("b", dims(5, { calibration: 6 })));
    const w = whyResult(r, names);
    expect(w.headline).toBe(`Rigorist beat Skeptic, ${r.hp.a} health left against ${r.hp.b}.`);
    expect(w.winner[0]).toBe("Hit hardest on evidence: 9 against 5, 12 damage.");
    expect(w.winner.join(" ")).toContain("Also ahead on fit");
    expect(w.winner.join(" ")).toContain("12% less damage taken");
    expect(w.loser[0]).toBe(`Behind on evidence, fit; lost ${r.taken.b} health.`);
    expect(w.loser.join(" ")).toContain("Its best hit was calibration");
    expect(w.loser.join(" ")).toContain("No cited sources, so no armour.");
  });
  it("names a knockout, and a dead heat", () => {
    expect(whyResult(duel(F("a", dims(10)), F("b", dims(0))), names).headline).toContain("knocked out");
    expect(whyResult(duel(F("a", dims(5)), F("b", dims(5))), names).headline).toContain("dead level");
  });
  it("never claims armour or a loser's hit that did not happen", () => {
    const w = whyResult(duel(F("a", dims(8)), F("b", dims(4))), names);
    expect(w.winner.join(" ")).not.toContain("armour");
    expect(w.loser.join(" ")).not.toContain("best hit");
  });
});
