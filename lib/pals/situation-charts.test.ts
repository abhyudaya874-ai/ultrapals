import { describe, expect, it } from "vitest";
import { heatData, leaderWaterfall, radarData, supportValue } from "./situation-charts";
import type { SituationCard } from "./situation";

type Part = SituationCard["rails"][number]["parts"][number];
const parts = (a: Part["support"], b: Part["support"]): Part[] => [{ need: "refunds_and_disputes", weight: 3, support: a }, { need: "cross_border_fx", weight: 1, support: b }];
const card = {
  needs: [{ need: "refunds_and_disputes", weight: 3, why: "" }, { need: "cross_border_fx", weight: 1, why: "" }],
  rails: [
    { rail: "stripe", name: "Stripe", fit: 0.75, upper: 0.75, known: 1, parts: parts("yes", "no") },
    { rail: "square", name: "Square", fit: 0.375, upper: 0.625, known: 0.75, parts: parts("partial", "unknown") },
    { rail: "paypal", name: "PayPal", fit: 0.25, upper: 0.25, known: 1, parts: parts("no", "yes") },
    { rail: "adyen", name: "Adyen", fit: 0, upper: 0, known: 1, parts: parts("no", "no") },
  ],
} as unknown as SituationCard;

describe("supportValue", () => {
  it.each([["yes", 1], ["partial", 0.5], ["no", 0], ["unknown", null]] as const)("%s", (s, v) => expect(supportValue(s)).toBe(v));
});
describe("radarData", () => {
  it("takes the top rails over the needs, unknown as 0", () => {
    const r = radarData(card);
    expect(r.axes).toEqual(["refunds and disputes", "cross border fx"]);
    expect(r.series.map((s) => [s.name, s.values])).toEqual([["Stripe", [1, 0]], ["Square", [0.5, 0]], ["PayPal", [0, 1]]]);
  });
  it("a limit of 1 gives just the leader", () => expect(radarData(card, 1).series).toHaveLength(1));
});
describe("heatData", () => {
  it("keeps unknown as null and words every cell", () => {
    const h = heatData(card);
    expect(h.values[1]).toEqual([0.5, null]);
    expect(h.words[1]).toEqual(["partly supported", "no cited answer"]);
    expect(h.rows).toEqual(["Stripe", "Square", "PayPal", "Adyen"]);
  });
});
describe("leaderWaterfall", () => {
  it("breaks the leader's fit into per-need contributions that add up to it", () => {
    const w = leaderWaterfall(card)!;
    expect(w.rail).toBe("Stripe");
    expect(w.steps.slice(0, -1).map((s) => s.value)).toEqual([75, 0]); // 3/4 weight, fully supported = 75 points
    expect(w.steps.slice(0, -1).reduce((a, s) => a + s.value, 0) / 100).toBeCloseTo(card.rails[0].fit);
    expect(w.steps.at(-1)).toMatchObject({ label: "Fit", total: true });
  });
  it("uses the rubric's leader when there is one", () => {
    const withRubric = { ...card, rubric: { leader: "paypal" } } as unknown as SituationCard;
    expect(leaderWaterfall(withRubric)!.rail).toBe("PayPal");
  });
  it("nothing to explain without rails or weight", () => {
    expect(leaderWaterfall({ ...card, rails: [] } as unknown as SituationCard)).toBeNull();
    expect(leaderWaterfall({ ...card, needs: [] } as unknown as SituationCard)).toBeNull();
  });
});
