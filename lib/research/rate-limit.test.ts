import { beforeEach, describe, expect, it } from "vitest";
import { allow, resetRateLimit } from "./rate-limit";

beforeEach(resetRateLimit);

describe("allow", () => {
  it("permits `limit` calls per window then refuses", () => {
    for (let i = 0; i < 3; i++) expect(allow("a", 1000 + i, 3, 60_000)).toBe(true);
    expect(allow("a", 1010, 3, 60_000)).toBe(false);
  });
  it("frees a slot once the oldest call leaves the window", () => {
    for (let i = 0; i < 3; i++) allow("a", 1000, 3, 60_000);
    expect(allow("a", 61_001, 3, 60_000)).toBe(true);
  });
  it("keeps keys independent", () => {
    for (let i = 0; i < 3; i++) allow("a", 1000, 3, 60_000);
    expect(allow("b", 1000, 3, 60_000)).toBe(true);
  });
});
