import { describe, expect, it } from "vitest";
import { articleFromProofUrl, isUnlockedFor } from "./newsroom-access";

const SLUG = "micropayment-economics-agents";
const PROOF = `https://pub.example.com/api/newsroom/proof?article=${SLUG}`;

describe("articleFromProofUrl", () => {
  it("extracts the article param", () => {
    expect(articleFromProofUrl(PROOF)).toBe(SLUG);
    expect(articleFromProofUrl("https://x.test/api/newsroom/proof")).toBeNull();
    expect(articleFromProofUrl("not a url")).toBeNull();
  });
});

describe("isUnlockedFor", () => {
  const row = (state: string, url = PROOF, needle = `unlocked:${SLUG}`) => ({ state, condition: { kind: "page_contains", url, needle } });
  it("unlocks only a captured promise conditioned on this article", () => {
    expect(isUnlockedFor(row("captured"), SLUG)).toBe(true);
    expect(isUnlockedFor(row("open"), SLUG)).toBe(false);
    expect(isUnlockedFor(row("released"), SLUG)).toBe(false);
    expect(isUnlockedFor(row("captured", "https://x.test/proof?article=other-story"), SLUG)).toBe(false);
    expect(isUnlockedFor(row("captured", PROOF, "unlocked:other-story"), SLUG)).toBe(false);
    expect(isUnlockedFor(row("captured", "https://x.test/other?article=" + SLUG), SLUG)).toBe(false); // needle must match too
    expect(isUnlockedFor(null, SLUG)).toBe(false);
    expect(isUnlockedFor({ state: "captured", condition: { kind: "none" } }, SLUG)).toBe(false);
  });
});
