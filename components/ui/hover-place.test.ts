import { describe, expect, it } from "vitest";
import { anchorVisible, placeCard, sameSpot } from "./hover-place";

const vp = { w: 1200, h: 800 };
const at = (left: number, top: number, width = 60, height = 20) => ({ left, top, width, height });

describe("placeCard above or below", () => {
  it("sits above the anchor, centred on it, when there is room", () => {
    const s = placeCard(at(500, 400), 300, vp, "top");
    expect(s.placed).toBe("top");
    expect(s.left).toBe(500 + 30 - 150);
    expect(s.bottom).toBe(800 - 400 + 8);
    expect(s.top).toBeUndefined();
  });
  it("flips below when the anchor is at the top of the screen", () => {
    const s = placeCard(at(500, 20), 300, vp, "top");
    expect(s.placed).toBe("bottom");
    expect(s.top).toBe(20 + 20 + 8);
    expect(s.bottom).toBeUndefined();
  });
  it("stays above when there is little room on either side but more above", () => {
    expect(placeCard(at(500, 300), 300, { w: 1200, h: 360 }, "top").placed).toBe("top");
  });
  it("is pushed back inside the viewport at both edges", () => {
    expect(placeCard(at(2, 400), 300, vp, "top").left).toBe(8);
    expect(placeCard(at(1190, 400), 300, vp, "top").left).toBe(1200 - 300 - 8);
  });
  it("can be asked to go below and flips above at the bottom", () => {
    expect(placeCard(at(500, 100), 300, vp, "bottom").placed).toBe("bottom");
    expect(placeCard(at(500, 770), 300, vp, "bottom").placed).toBe("top");
  });
  it("caps its height to the room it has", () => {
    const s = placeCard(at(500, 200), 300, vp, "top");
    expect(s.maxHeight).toBeLessThanOrEqual(184);
    expect(s.maxHeight).toBeGreaterThanOrEqual(80);
  });
});

describe("placeCard beside", () => {
  it("goes to the right of the anchor", () => {
    const s = placeCard(at(100, 200, 220, 70), 320, vp, "right");
    expect(s).toMatchObject({ placed: "right", left: 100 + 220 + 8, top: 200 });
  });
  it("goes to the left when the right has no room", () => {
    const s = placeCard(at(900, 200, 220, 70), 320, vp, "right");
    expect(s.placed).toBe("left");
    expect(s.left).toBe(900 - 8 - 320);
  });
  it("never starts above the viewport or too low to read", () => {
    expect(placeCard(at(100, -50, 220, 70), 320, vp, "right").top).toBe(8);
    expect(placeCard(at(100, 790, 220, 70), 320, vp, "right").top).toBe(800 - 8 - 120);
  });
});

describe("sameSpot: a card does not move when its trigger has not", () => {
  const a = placeCard(at(500, 400), 300, vp, "top");
  it("is true for the same placement, and for one a fraction of a pixel away", () => {
    expect(sameSpot(a, placeCard(at(500, 400), 300, vp, "top"))).toBe(true);
    expect(sameSpot(a, placeCard(at(500.3, 400.2), 300, vp, "top"))).toBe(true);
  });
  it("is false when the trigger moved (the page scrolled or the text above it grew)", () => {
    expect(sameSpot(a, placeCard(at(500, 380), 300, vp, "top"))).toBe(false);
    expect(sameSpot(a, placeCard(at(540, 400), 300, vp, "top"))).toBe(false);
  });
  it("is false when the card flipped to the other side", () => {
    expect(sameSpot(a, placeCard(at(500, 20), 300, vp, "top"))).toBe(false);
  });
});

describe("anchorVisible: a card follows its trigger until the trigger is gone", () => {
  it("is true while any part of the trigger is on screen", () => {
    expect(anchorVisible(at(500, 400), vp)).toBe(true);
    expect(anchorVisible(at(-30, 400), vp)).toBe(true); // half off the left edge
    expect(anchorVisible(at(500, 790), vp)).toBe(true); // half off the bottom
  });
  it("is false once it has scrolled fully out of view", () => {
    expect(anchorVisible(at(500, -40), vp)).toBe(false);
    expect(anchorVisible(at(500, 810), vp)).toBe(false);
    expect(anchorVisible(at(-80, 400), vp)).toBe(false);
    expect(anchorVisible(at(1210, 400), vp)).toBe(false);
  });
});
