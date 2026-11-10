import { describe, expect, it } from "vitest";
import { SUPER_PALS, scoreSuperPals } from "./superpals";
import { decideSeal } from "./seal";
import { scoreLadder } from "./ladder";
import { ARCHETYPES } from "./rival";

const CLEAN = { attacksRun: 12, values: { attacks_missed: 0, human_steps_at_capture: 0, buyer_steps: 2, evidence_fields_missing: 0, fee_over_budget_minor: 0, unquoted_fx_claims: 0, unsigned_agent_actions: 0, reversal_unverified: 0 } };

describe("scoreSuperPals", () => {
  it("eight seeded examiners, every bar analyst-set or measured, every counter a PayPal capability", () => {
    expect(SUPER_PALS.map((p) => p.name)).toEqual(["StripePal", "ShopifyPal", "ApplePal", "AdyenPal", "WisePal", "KlarnaPal", "X402Pal", "SquarePal"]);
    for (const p of SUPER_PALS) expect(p.counter.docUrl).toContain("developer.paypal.com");
  });
  it("without keys, every keyed row is NOT_MEASURABLE naming its env key - never a pass", () => {
    const rows = scoreSuperPals({});
    expect(rows.every((r) => r.status === "NOT_MEASURABLE")).toBe(true);
    expect(rows[0].note).toBe("STRIPE_SANDBOX_KEY not provided yet");
  });
  it("X402Pal needs no key: it is measured from the run log, and a human at capture misses its bar", () => {
    const [x] = scoreSuperPals({ values: { human_steps_at_capture: 0 } }, [SUPER_PALS[6]]);
    expect(x.pal.id).toBe("x402");
    expect(x.status).toBe("BAR_MET");
    expect(scoreSuperPals({ values: { human_steps_at_capture: 1 } }, [SUPER_PALS[6]])[0].status).toBe("BAR_MISSED");
  });
  it("a present key with no measurement is still NOT_MEASURABLE", () => {
    expect(scoreSuperPals({ keysPresent: { STRIPE_SANDBOX_KEY: true } })[0].status).toBe("NOT_MEASURABLE");
  });
  it("a >= bar met and missed", () => {
    const [w] = scoreSuperPals({ keysPresent: { WISE_SANDBOX_KEY: true }, values: { fx_quote_present: 1 } }, [SUPER_PALS[4]]);
    expect(w.status).toBe("BAR_MET");
    expect(scoreSuperPals({ keysPresent: { WISE_SANDBOX_KEY: true }, values: { fx_quote_present: 0 } }, [SUPER_PALS[4]])[0].status).toBe("BAR_MISSED");
  });
  it("SuperPal rows never gate the seal: a missed delta leaves the exam verdict alone", () => {
    const examRows = scoreLadder(CLEAN, ARCHETYPES);
    expect(decideSeal(examRows).seal).toBe("SEALED");
    const missed = scoreSuperPals({ values: { human_steps_at_capture: 9 } }).filter((r) => r.status === "BAR_MISSED");
    expect(missed.length).toBeGreaterThan(0);
    expect(decideSeal(examRows).seal).toBe("SEALED");
  });
});
