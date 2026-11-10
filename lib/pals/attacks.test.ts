import { describe, expect, it } from "vitest";
import { NOT_AT_VERDICT_LEVEL, runAttacks } from "./attacks";
import { MUTATIONS } from "./rival";

describe("runAttacks (real judge, hostile worlds)", () => {
  it("every mutation is either attacked or explicitly accounted for", () => {
    const r = runAttacks(MUTATIONS);
    expect(r.run.length + r.skipped.length).toBe(MUTATIONS.length);
    expect(r.skipped.map((s) => s.mutation).sort()).toEqual(Object.keys(NOT_AT_VERDICT_LEVEL).sort());
  });
  it("the judge survives all ten verdict-level attacks, and the clean world does capture", () => {
    const r = runAttacks(MUTATIONS);
    expect(r.baselineCaptures).toBe(true);
    expect(r.run.length).toBe(10);
    expect(r.run.filter((x) => !x.survived)).toEqual([]);
  });
  const WANT: [string, string][] = [
    ["placeholder_asset", "WAIT"], ["cloaked_page", "RELEASE"], ["currency_drift", "WAIT"], ["partial_delivery", "WAIT"],
    ["stale_cache", "WAIT"], ["timeout", "WAIT"], ["contradictory_observers", "WAIT"], ["relist_new_id", "WAIT"],
  ];
  it.each(WANT)("%s resolves to %s, not CAPTURE", (m, got) => {
    expect(runAttacks([m as (typeof MUTATIONS)[number]]).run[0].got).toBe(got);
  });
  it("a de-duplicated request attacks once", () => {
    expect(runAttacks(["timeout", "timeout"]).run.length).toBe(1);
  });
  it("skipped mutations carry the reason they are guarded elsewhere", () => {
    expect(runAttacks(["duplicate_callback"]).skipped[0].why).toContain("idempotent");
  });
});
