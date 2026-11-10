import { describe, expect, it } from "vitest";
import { PERSONAS, STANCES, TOOL_HINT, contenderInfo, lineup } from "./personas";

describe("lineup", () => {
  it.each([2, 3, 4, 5, 6])("%i contenders are all different in persona, stance and id", (n) => {
    const l = lineup(n);
    expect(l).toHaveLength(n);
    expect(new Set(l.map((x) => x.persona.id)).size).toBe(n);
    expect(new Set(l.map((x) => x.stance.id)).size).toBe(n);
    expect(new Set(l.map((x, i) => contenderInfo(i, x).id)).size).toBe(n);
  });
  it("two contenders are the most optimistic against the most pessimistic, with opposed stances", () => {
    const [a, b] = lineup(2);
    expect([a.persona.id, b.persona.id]).toEqual(["maximalist", "skeptic"]);
    expect([a.stance.id, b.stance.id]).toEqual(["up", "down"]);
  });
  it("more contenders fill in the middle, extremes first", () => {
    expect(lineup(4).map((x) => x.persona.lean)).toEqual([1, -1, 0.4, -0.6]);
  });
  it("the tools differ between neighbours, so the contenders start in different places", () => {
    expect(lineup(3).map((x) => x.tool)).toEqual(["research", "terminal", "browser"]);
  });
  it("is deterministic and clamps to the range 2..6", () => {
    expect(lineup(4)).toEqual(lineup(4));
    expect(lineup(1)).toHaveLength(2);
    expect(lineup(99)).toHaveLength(6);
    expect(lineup(Number.NaN)).toHaveLength(2);
  });
});

describe("the closed lists", () => {
  it("every persona has a directive and a lean in range", () => {
    for (const p of PERSONAS) { expect(p.directive.length).toBeGreaterThan(30); expect(Math.abs(p.lean)).toBeLessThanOrEqual(1); }
  });
  it("stances start with an opposed pair", () => expect([STANCES[0].id, STANCES[1].id]).toEqual(["up", "down"]));
  it("every tool has a starting hint", () => expect(Object.keys(TOOL_HINT).sort()).toEqual(["browser", "research", "terminal"]));
});
