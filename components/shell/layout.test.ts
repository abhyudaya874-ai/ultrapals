import { describe, expect, it } from "vitest";
import { LIMITS, RAIL_W, clampWidth, dragPanel, keyPanel, parsePref } from "./layout";

const L = LIMITS.sidebar; // 216..420, default 272

describe("clampWidth", () => {
  it.each([[100, 216], [216, 216], [300, 300], [420, 420], [999, 420], [Number.NaN, 272], [Infinity, 272]])("%d -> %d", (w, want) => expect(clampWidth(w, L)).toBe(want));
});

describe("dragPanel", () => {
  const open = { w: 272, collapsed: false };
  it("a left panel grows when its edge is dragged right and shrinks when dragged left", () => {
    expect(dragPanel(open, 50, "left", L)).toEqual({ w: 322, collapsed: false });
    expect(dragPanel(open, -30, "left", L)).toEqual({ w: 242, collapsed: false });
  });
  it("a right panel grows when its edge is dragged left", () => {
    const R = LIMITS.artifacts;
    expect(dragPanel({ w: 640, collapsed: false }, -100, "right", R)).toEqual({ w: 740, collapsed: false });
    expect(dragPanel({ w: 640, collapsed: false }, 100, "right", R)).toEqual({ w: 540, collapsed: false });
  });
  it("stops at the limits", () => {
    expect(dragPanel(open, 5000, "left", L).w).toBe(420);
    expect(dragPanel(open, -60, "left", L)).toEqual({ w: 216, collapsed: false }); // 212 is still above the snap line
  });
  it("snaps shut when dragged well below the minimum, and remembers the width", () => {
    expect(dragPanel(open, -200, "left", L)).toEqual({ w: 272, collapsed: true });
  });
  it("a collapsed panel opens when its rail is dragged out far enough", () => {
    const shut = { w: 300, collapsed: true };
    expect(dragPanel(shut, 20, "left", L)).toEqual({ w: 300, collapsed: true });
    expect(dragPanel(shut, 200, "left", L)).toEqual({ w: RAIL_W + 200, collapsed: false });
  });
});

describe("keyPanel", () => {
  const p = { w: 300, collapsed: false };
  it("the arrow pointing away from a left panel grows it; the other shrinks it", () => {
    expect(keyPanel(p, "ArrowRight", "left", L)).toEqual({ w: 324, collapsed: false });
    expect(keyPanel(p, "ArrowLeft", "left", L)).toEqual({ w: 276, collapsed: false });
  });
  it("mirrored for a right panel", () => {
    expect(keyPanel({ w: 500, collapsed: false }, "ArrowLeft", "right", LIMITS.artifacts)?.w).toBe(524);
  });
  it("shrinking below the minimum collapses instead of squeezing", () => expect(keyPanel({ w: 220, collapsed: false }, "ArrowLeft", "left", L)).toEqual({ w: 220, collapsed: true }));
  it("Home, End and Enter", () => {
    expect(keyPanel(p, "Home", "left", L)).toEqual({ w: 216, collapsed: false });
    expect(keyPanel(p, "End", "left", L)).toEqual({ w: 420, collapsed: false });
    expect(keyPanel(p, "Enter", "left", L)).toEqual({ w: 300, collapsed: true });
  });
  it("other keys do nothing", () => expect(keyPanel(p, "a", "left", L)).toBeNull());
});

describe("parsePref", () => {
  it.each([[null], ["nope"], ["{}"], ['{"w":"wide"}']])("%j -> defaults", (raw) => expect(parsePref(raw, L)).toEqual({ w: 272, collapsed: false }));
  it("keeps good values within limits", () => {
    expect(parsePref('{"w":9999,"collapsed":true}', L)).toEqual({ w: 420, collapsed: true });
    expect(parsePref('{"w":250}', L)).toEqual({ w: 250, collapsed: false });
  });
});
