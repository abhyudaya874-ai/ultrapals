import { describe, expect, it } from "vitest";
import { ARCHETYPE_TABLE, scoreLadder, tally, type Measurements, type RowStatus } from "./ladder";
import { ARCHETYPES, type Archetype } from "./rival";
import { decideSeal, type Seal } from "./seal";

const CLEAN: Measurements = {
  attacksRun: 12,
  values: { attacks_missed: 0, human_steps_at_capture: 0, buyer_steps: 2, evidence_fields_missing: 0, fee_over_budget_minor: 0, unquoted_fx_claims: 0, unsigned_agent_actions: 0, reversal_unverified: 0 },
};
const status = (m: Measurements, a: Archetype): RowStatus => scoreLadder(m, [a])[0].status;
const withValue = (k: keyof Measurements["values"], v: number | undefined): Measurements => ({ ...CLEAN, values: { ...CLEAN.values, [k]: v } });

describe("scoreLadder", () => {
  it("every archetype has a bar, and a clean run meets all of them", () => {
    expect(Object.keys(ARCHETYPE_TABLE).sort()).toEqual([...ARCHETYPES].sort());
    expect(tally(scoreLadder(CLEAN)).BAR_MET).toBe(ARCHETYPES.length);
  });
  const ROWS: [string, Measurements, Archetype, RowStatus][] = [
    ["friction: 2 steps is the line", withValue("buyer_steps", 2), "friction", "BAR_MET"],
    ["friction: 3 steps misses", withValue("buyer_steps", 3), "friction", "BAR_MISSED"],
    ["latency: a human at capture misses", withValue("human_steps_at_capture", 1), "latency", "BAR_MISSED"],
    ["a measurement that was never taken is NOT_MEASURABLE, never a pass", withValue("unquoted_fx_claims", undefined), "corridor", "NOT_MEASURABLE"],
    ["a fractional measurement is NOT_MEASURABLE", withValue("buyer_steps", 1.5), "friction", "NOT_MEASURABLE"],
    ["a negative measurement is NOT_MEASURABLE", withValue("buyer_steps", -1), "friction", "NOT_MEASURABLE"],
    ["counterparty: zero attacks run proves nothing", { ...CLEAN, attacksRun: 0 }, "counterparty", "NOT_MEASURABLE"],
    ["counterparty: one attack missed misses", withValue("attacks_missed", 1), "counterparty", "BAR_MISSED"],
    ["not applicable is declared, not inferred", { ...CLEAN, notApplicable: { latency: "nobody is absent at capture" } }, "latency", "NOT_APPLICABLE"],
  ];
  it.each(ROWS)("%s", (_n, m, a, want) => expect(status(m, a)).toBe(want));
  it("is byte-identical on a repeat call", () => {
    expect(JSON.stringify(scoreLadder(CLEAN))).toBe(JSON.stringify(scoreLadder(JSON.parse(JSON.stringify(CLEAN)))));
  });
});

describe("decideSeal", () => {
  const seal = (m: Measurements, only?: Archetype[]): Seal => decideSeal(scoreLadder(m, only)).seal;
  const ROWS: [string, Measurements, Archetype[] | undefined, Seal][] = [
    ["all closed -> SEALED", CLEAN, undefined, "SEALED"],
    ["a missed observable axis -> CONDITIONAL", withValue("buyer_steps", 7), undefined, "CONDITIONAL"],
    ["a blind observable axis -> CONDITIONAL", withValue("unquoted_fx_claims", undefined), undefined, "CONDITIONAL"],
    ["a missed hard axis -> REFUSED", withValue("reversal_unverified", 1), undefined, "REFUSED"],
    ["a counterparty attack that landed -> REFUSED", withValue("attacks_missed", 1), undefined, "REFUSED"],
    ["a blind unobservable axis -> REFUSED", withValue("unsigned_agent_actions", undefined), undefined, "REFUSED"],
    ["nothing measured -> REFUSED", { values: {} }, [], "REFUSED"],
    ["only N/A rows -> REFUSED", { ...CLEAN, notApplicable: { friction: "n/a" } }, ["friction"], "REFUSED"],
    ["four open axes is too much dissent -> REFUSED", { ...CLEAN, values: { ...CLEAN.values, buyer_steps: 9, evidence_fields_missing: 1, unquoted_fx_claims: 1, human_steps_at_capture: 1 } }, undefined, "REFUSED"],
    ["three open axes still ship -> CONDITIONAL", { ...CLEAN, values: { ...CLEAN.values, buyer_steps: 9, evidence_fields_missing: 1, unquoted_fx_claims: 1 } }, undefined, "CONDITIONAL"],
  ];
  it.each(ROWS)("%s", (_n, m, only, want) => expect(seal(m, only)).toBe(want));
  it("names the live conditions it compiled", () => {
    expect(decideSeal(scoreLadder({ ...CLEAN, values: { ...CLEAN.values, buyer_steps: 9, unquoted_fx_claims: 1 } })).liveConditions).toEqual(["friction", "corridor"]);
  });
  it("a N/A axis never blocks a seal", () => {
    expect(seal({ ...CLEAN, notApplicable: { latency: "standing promise has nobody present" } })).toBe("SEALED");
  });
});
