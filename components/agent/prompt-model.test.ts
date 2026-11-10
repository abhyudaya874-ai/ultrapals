import { describe, expect, it } from "vitest";
import { canSend, placeholderFor } from "./prompt-model";

describe("canSend", () => {
  it("needs two characters of text or a picture", () => {
    expect(canSend("", 0)).toBe(false);
    expect(canSend(" a ", 0)).toBe(false);
    expect(canSend("hi", 0)).toBe(true);
    expect(canSend("", 1)).toBe(true);
  });
  it("waits while a picture is still being prepared, even with text", () => {
    expect(canSend("hello there", 0, 1)).toBe(false);
    expect(canSend("", 2, 1)).toBe(false);
    expect(canSend("hello there", 1, 0)).toBe(true);
  });
});

describe("placeholderFor", () => {
  it("says what a message does in each mode", () => {
    expect(placeholderFor("chat", false)).toBe("Type a command…");
    expect(placeholderFor("battle", false)).toMatch(/opposite predictions/);
    expect(placeholderFor("loop", false)).toMatch(/different version/);
  });
  it("while the agent waits for the person, the box says what to type", () => {
    expect(placeholderFor("chat", false, true)).toMatch(/Say "continue"/);
    expect(placeholderFor("battle", false, true)).toMatch(/Say "continue"/);
    expect(placeholderFor("chat", true, true)).toMatch(/follow-up/);
  });
  it("a running agent asks for a follow-up whatever the mode", () => {
    for (const k of ["chat", "battle", "loop"] as const) expect(placeholderFor(k, true)).toMatch(/follow-up/);
  });
});
