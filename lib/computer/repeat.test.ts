import { describe, expect, it } from "vitest";
import { repeatState } from "./repeat";

describe("repeatState", () => {
  it("is fresh, then again, then stuck", () => {
    expect(repeatState([], "a")).toBe("fresh");
    expect(repeatState(["a"], "a")).toBe("again");
    expect(repeatState(["a", "b", "a"], "a")).toBe("stuck");
    expect(repeatState(["a", "b"], "c")).toBe("fresh");
  });
  it("only looks at the recent window", () => {
    expect(repeatState(["a", ...Array.from({ length: 10 }, (_, i) => `x${i}`)], "a", 10)).toBe("fresh");
  });
});
