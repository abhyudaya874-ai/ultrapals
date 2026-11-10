import { describe, expect, it } from "vitest";
import { excerpt } from "./excerpt";

describe("excerpt", () => {
  it("keeps a short passage as it is, with the whitespace tidied", () => expect(excerpt("  one \n two  ")).toBe("one two"));
  it("cuts a long passage on a word and marks the cut", () => {
    const e = excerpt("word ".repeat(100), 50);
    expect(e.endsWith("…")).toBe(true);
    expect(e.length).toBeLessThanOrEqual(51);
    expect(e).not.toMatch(/wor…$/);
  });
  it("cuts mid-word only when there is no space to cut at", () => expect(excerpt("x".repeat(100), 20)).toBe(`${"x".repeat(20)}…`));
});
