import { describe, expect, it } from "vitest";
import type { Condition } from "@/lib/verdict";
import { describeCondition } from "./describe-condition";

const ROWS: [string, Condition, RegExp][] = [
  ["none", { kind: "none" }, /Capture as soon as the payer approves\./],
  [
    "price_at_most",
    { kind: "price_at_most", query: "Nike Pegasus 41", ceilingMinor: 12000, currency: "USD" },
    /"Nike Pegasus 41" costs 120\.00 USD or less\./,
  ],
  [
    "page_contains",
    { kind: "page_contains", url: "https://example.com/status", needle: "all systems go" },
    /example\.com\/status contains "all systems go"\./,
  ],
];

describe("describeCondition", () => {
  it.each(ROWS)("%s", (_n, c, want) => expect(describeCondition(c)).toMatch(want));
  it("returns a non-empty sentence for every kind (exhaustive switch: a new kind fails tsc)", () => {
    for (const c of ROWS.map((r) => r[1])) {
      const s = describeCondition(c);
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
