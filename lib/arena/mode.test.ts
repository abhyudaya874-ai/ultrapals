import { describe, expect, it } from "vitest";
import { COUNTS, DEFAULT_MODE, countHint, defaultCount, parseMode } from "./mode";

describe("parseMode", () => {
  it("accepts a good mode", () => expect(parseMode({ kind: "battle", n: 3, plan: "ai" })).toEqual({ kind: "battle", n: 3, plan: "ai" }));
  it.each([[null], [undefined], ["battle"], [42], [[]], [{}]])("falls back to chat for %j", (raw) => expect(parseMode(raw)).toEqual({ kind: "chat", n: 4, plan: "auto" }));
  it("keeps the number inside 2..6 and whole", () => {
    expect(parseMode({ kind: "battle", n: 99 }).n).toBe(6);
    expect(parseMode({ kind: "battle", n: 0 }).n).toBe(2);
    expect(parseMode({ kind: "battle", n: 3.6 }).n).toBe(4);
    expect(parseMode({ kind: "battle", n: "5" }).n).toBe(4);
    expect(parseMode({ kind: "battle", n: Number.NaN }).n).toBe(4);
  });
  it("a loop starts with five rounds, a battle with four", () => {
    expect(parseMode({ kind: "loop" }).n).toBe(5);
    expect(defaultCount("battle")).toBe(4);
  });
  it("an unknown plan mode is Autopilot", () => expect(parseMode({ kind: "loop", plan: "yolo" }).plan).toBe("auto"));
  it("the default is a chat and the counts run 2 to 6", () => {
    expect(DEFAULT_MODE.kind).toBe("chat");
    expect(COUNTS).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("countHint", () => {
  it.each([["battle", 2, "head-to-head"], ["battle", 3, "one bye"], ["battle", 4, "semi-finals"], ["battle", 5, "3 byes"], ["battle", 6, "2 byes"], ["loop", 2, "one test"], ["loop", 5, "up to 5 rounds"]] as const)("%s %i", (k, n, text) => expect(countHint(k, n)).toContain(text));
  it("a chat has no count", () => expect(countHint("chat", 4)).toBe(""));
});
