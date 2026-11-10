import { describe, expect, it } from "vitest";
import { runExam } from "./exam";
import type { Rival } from "./rival";

const rival = (archetype: Rival["archetype"], attack: Rival["attack"]): Rival => ({
  archetype, attack, thesisOwner: "Acme", failureClass: `${archetype} ${attack}`,
  counter: { capability: "Void", docUrl: "https://developer.paypal.com/x" },
  sources: [{ url: "https://a.example.com/x", operator: "tavily", fetchedAtMs: 1, quote: "Acme says so" }],
});

describe("runExam", () => {
  it("always examines the counterparty axis, and the judge survives its attacks", () => {
    const r = runExam([rival("evidence", "placeholder_asset"), rival("corridor", "currency_drift")]);
    expect(r.archetypes).toEqual(["counterparty", "evidence", "corridor"]);
    expect(r.rows[0]).toMatchObject({ archetype: "counterparty", status: "BAR_MET", observed: 0 });
    expect(r.attacks.run.length).toBe(2);
  });
  it("axes nobody measured are NOT_MEASURABLE and ship as live conditions, not as passes", () => {
    const r = runExam([rival("evidence", "placeholder_asset"), rival("corridor", "currency_drift")]);
    expect(r.rows.map((x) => x.status)).toEqual(["BAR_MET", "NOT_MEASURABLE", "NOT_MEASURABLE"]);
    expect(r.seal).toMatchObject({ seal: "CONDITIONAL", liveConditions: ["evidence", "corridor"] });
  });
  it("measured values close axes, and a declared N/A does not block", () => {
    const r = runExam([rival("evidence", "placeholder_asset"), rival("latency", "timeout")], { values: { evidence_fields_missing: 0 }, notApplicable: { latency: "nobody is absent at capture" } });
    expect(r.seal.seal).toBe("SEALED");
  });
  it("a hard axis that was never exercised refuses the deal", () => {
    expect(runExam([rival("reversal", "timeout")]).seal).toMatchObject({ seal: "REFUSED", reason: "hard axis open: reversal" });
  });
  it("rivals whose attacks are guarded elsewhere leave counterparty NOT_MEASURABLE (no attack ran)", () => {
    const r = runExam([rival("counterparty", "duplicate_callback")]);
    expect(r.attacks.run).toEqual([]);
    expect(r.rows[0].status).toBe("NOT_MEASURABLE");
    expect(r.seal.seal).toBe("REFUSED");
  });
  it("a caller cannot smuggle in attacks_missed: it is recomputed from the real run", () => {
    const r = runExam([rival("evidence", "timeout")], { values: { attacks_missed: 99 } });
    expect(r.rows[0]).toMatchObject({ status: "BAR_MET", observed: 0 });
  });
  it("lists the axes it left out, with a reason", () => {
    expect(runExam([rival("evidence", "timeout")]).excluded.map((e) => e.archetype)).toEqual(["latency", "friction", "cost", "corridor", "identity", "reversal"]);
  });
});
