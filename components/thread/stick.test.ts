import { describe, expect, it } from "vitest";
import { NEAR_END, NEAR_END_SMALL, awayFromEnd, needsJump, nextAway, pixelsToEnd } from "./stick";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 200) => ({ scrollTop, scrollHeight, clientHeight });

describe("pixelsToEnd", () => {
  it("is what is still below the visible part", () => {
    expect(pixelsToEnd(box(0))).toBe(800);
    expect(pixelsToEnd(box(800))).toBe(0);
  });
  it("never goes negative (browsers overshoot by a fraction)", () => {
    expect(pixelsToEnd(box(800.6))).toBe(0);
  });
  it("is zero for a box that does not scroll", () => {
    expect(pixelsToEnd({ scrollTop: 0, scrollHeight: 150, clientHeight: 200 })).toBe(0);
  });
});

describe("awayFromEnd", () => {
  it("at the end is not away", () => expect(awayFromEnd(box(800))).toBe(false));
  it("a little above the end still counts as at the end", () => {
    expect(awayFromEnd(box(800 - NEAR_END))).toBe(false);
    expect(awayFromEnd(box(800 - NEAR_END - 1))).toBe(true);
  });
  it("a small box has a smaller slack", () => {
    expect(awayFromEnd(box(800 - NEAR_END_SMALL), NEAR_END_SMALL)).toBe(false);
    expect(awayFromEnd(box(800 - NEAR_END_SMALL - 1), NEAR_END_SMALL)).toBe(true);
  });
});

describe("nextAway: follow, stop when the reader scrolls up, follow again when they come back", () => {
  it("scrolling up stops the following", () => {
    expect(nextAway(false, box(300), false)).toBe(true);
  });
  it("scrolling back to the end starts it again", () => {
    expect(nextAway(true, box(795), false)).toBe(false);
  });
  it("a scroll that the jump to the end caused is not the reader leaving, even if the text grew meanwhile", () => {
    // we jumped to the end of a 1000px box; before the event arrived it grew to 1400px, so it now looks 400px short of the end
    const grown = { scrollTop: 800, scrollHeight: 1400, clientHeight: 200 };
    expect(awayFromEnd(grown)).toBe(true);
    expect(nextAway(false, grown, true)).toBe(false);
  });
  it("our own scroll does not undo the reader having left either", () => {
    expect(nextAway(true, box(795), true)).toBe(true);
  });
});

describe("needsJump", () => {
  it("jumps when there is something below", () => expect(needsJump(box(500))).toBe(true));
  it("does not jump when already at the end", () => {
    expect(needsJump(box(800))).toBe(false);
    expect(needsJump(box(799.5))).toBe(false);
  });
});
