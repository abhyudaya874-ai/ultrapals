import { describe, expect, it } from "vitest";
import { REASON_CODES } from "@/lib/verdict";
import { REASON_SENTENCE } from "./reason-copy";

describe("REASON_SENTENCE", () => {
  it("has exactly one sentence per closed reason code", () => {
    expect(Object.keys(REASON_SENTENCE).sort()).toEqual([...REASON_CODES].sort());
  });
  it("stays in the friendly register (no collections-report words)", () => {
    for (const s of Object.values(REASON_SENTENCE)) expect(s).not.toMatch(/\b(overdue|owe[sd]?|collections?|penalt(y|ies)|delinquent)\b/i);
  });
  it("every sentence is one plain sentence", () => {
    for (const s of Object.values(REASON_SENTENCE)) {
      expect(s.endsWith(".")).toBe(true);
      expect(s.length).toBeLessThan(120);
    }
  });
});
