import { describe, expect, it } from "vitest";
import { measureRun, type PromiseRunLog } from "./measure";

const log = (o: Partial<PromiseRunLog>): PromiseRunLog => ({ promiseId: "p1", approved: true, settled: true, state: "captured", orderStatusAfter: "COMPLETED", moneyOpsCarriedId: true, currency: "USD", ...o });

describe("measureRun", () => {
  it("no log measures nothing", () => {
    expect(measureRun(null)).toEqual({ values: {}, notApplicable: {}, from: [] });
  });
  it("a captured run: machine capture, signed ops, evidence stored; reversal does not bite", () => {
    const m = measureRun(log({}));
    expect(m.values).toMatchObject({ unsigned_agent_actions: 0, human_steps_at_capture: 0, evidence_fields_missing: 0 });
    expect(m.notApplicable.reversal).toContain("refund route not exercised");
    expect(m.from).toContain("human_steps_at_capture");
  });
  it("a released run with a read-back that shows no money moved: reversal verified", () => {
    expect(measureRun(log({ state: "released", orderStatusAfter: "APPROVED" })).values.reversal_unverified).toBe(0);
  });
  it("a released run whose order read-back says COMPLETED: the release lied", () => {
    expect(measureRun(log({ state: "released", orderStatusAfter: "COMPLETED" })).values.reversal_unverified).toBe(1);
  });
  it("a released run nobody could read back: reversal unverified, never assumed good", () => {
    expect(measureRun(log({ state: "released", orderStatusAfter: null })).values.reversal_unverified).toBe(1);
  });
  it("a WAIT run has nothing to reverse", () => {
    const m = measureRun(log({ state: "wait", settled: false, orderStatusAfter: "APPROVED" }));
    expect(m.values.human_steps_at_capture).toBeUndefined();
    expect(m.notApplicable.reversal).toContain("nothing to reverse");
  });
  it("unsigned money ops are caught, and a single-currency deal is declared, not measured", () => {
    const m = measureRun(log({ moneyOpsCarriedId: false }));
    expect(m.values.unsigned_agent_actions).toBe(1);
    expect(m.notApplicable.corridor).toBe("single-currency deal (USD)");
  });
});
