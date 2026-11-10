import { describe, expect, it } from "vitest";
import { arcPath, compact, timeTicks, donutArcs, heat, niceTicks, polar, radarShape, scale, toCandles, waterfall } from "./geometry";

describe("niceTicks", () => {
  it.each([
    [0, 97, [0, 20, 40, 60, 80, 100]],
    [3, 7, [3, 4, 5, 6, 7]],
    [0, 1, [0, 0.2, 0.4, 0.6, 0.8, 1]],
    [-50, 50, [-60, -40, -20, 0, 20, 40, 60]],
  ])("%d..%d", (lo, hi, want) => expect(niceTicks(lo, hi).ticks).toEqual(want));
  it("always covers the data", () => {
    for (const [lo, hi] of [[0.13, 0.91], [1234, 98765], [-7, -2], [5, 5], [0, 0]] as const) {
      const t = niceTicks(lo, hi);
      expect(t.min).toBeLessThanOrEqual(lo);
      expect(t.max).toBeGreaterThanOrEqual(hi);
      expect(t.ticks.length).toBeGreaterThan(1);
    }
  });
  it("survives NaN and infinity", () => expect(niceTicks(Number.NaN, 4)).toEqual({ ticks: [0, 1], min: 0, max: 1 }));
});

describe("scale / polar", () => {
  it("maps linearly, and a flat domain to the middle", () => {
    expect(scale(0, 10, 100, 200)(5)).toBe(150);
    expect(scale(3, 3, 0, 100)(3)).toBe(50);
  });
  it("angle 0 is up and angles run clockwise", () => {
    const up = polar(10, 10, 5, 0);
    expect([up.x, up.y]).toEqual([10, 5]);
    const right = polar(10, 10, 5, Math.PI / 2);
    expect([Math.round(right.x), Math.round(right.y)]).toEqual([15, 10]);
  });
});

describe("radarShape", () => {
  it("scales each axis by its value and clamps to 0..1", () => {
    const r = radarShape([1, 0.5, 2, -1], 0, 0, 100);
    expect(r.points.map((p) => [Math.round(p.x) + 0, Math.round(-p.y) + 0])).toEqual([[0, 100], [50, 0], [0, -100], [0, 0]]);
    expect(r.axes).toHaveLength(4);
  });
});

describe("toCandles", () => {
  const H = 3_600_000;
  it("open is the first value, close the last, high and low the extremes", () => {
    const c = toCandles([{ t: 2, v: 5 }, { t: 1, v: 3 }, { t: 3, v: 9 }, { t: H + 1, v: 4 }], H);
    expect(c).toEqual([{ t: 0, open: 3, close: 9, high: 9, low: 3, n: 3 }, { t: H, open: 4, close: 4, high: 4, low: 4, n: 1 }]);
  });
  it("ignores bad points and returns oldest first", () => {
    expect(toCandles([{ t: Number.NaN, v: 1 }, { t: 2 * H, v: 1 }, { t: 0, v: Infinity }, { t: 0, v: 2 }], H).map((c) => c.t)).toEqual([0, 2 * H]);
    expect(toCandles([], H)).toEqual([]);
  });
});

describe("waterfall", () => {
  it("accumulates deltas and shows a total bar", () => {
    const w = waterfall([{ label: "Promised", value: 100 }, { label: "Released", value: -30 }, { label: "Declined", value: -20 }, { label: "Captured", value: 0, total: true }]);
    expect(w.map((b) => [b.kind, b.from, b.to])).toEqual([["start", 0, 100], ["down", 100, 70], ["down", 70, 50], ["total", 0, 50]]);
  });
  it("a rise is 'up'", () => expect(waterfall([{ label: "a", value: 5 }, { label: "b", value: 3 }])[1]).toMatchObject({ kind: "up", from: 5, to: 8 }));
});

describe("donutArcs / arcPath", () => {
  it("arcs cover the circle in proportion, skipping non-positive values", () => {
    const a = donutArcs([1, 1, 0, -4, 2]);
    expect(a.map((x) => +x.share.toFixed(2))).toEqual([0.25, 0.25, 0, 0, 0.5]);
    expect(a.at(-1)!.a1).toBeCloseTo(Math.PI * 2);
  });
  it("all zeros gives empty arcs, not NaN", () => expect(donutArcs([0, 0]).every((x) => x.a0 === 0 && x.a1 === 0)).toBe(true));
  it("a full circle is drawn as a valid path", () => {
    const d = arcPath(50, 50, 30, 40, 0, Math.PI * 2);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toContain("NaN");
  });
});

describe("heat / compact", () => {
  it("is a ramp, and null is faint", () => {
    expect(heat(0)).toBe("rgb(30,44,49)");
    expect(heat(1)).toBe("rgb(226,214,140)");
    expect(heat(null)).toContain("rgba");
    expect(heat(5)).toBe(heat(1));
    expect(heat(-1)).toBe(heat(0));
  });
  it.each([[999, "999"], [1200, "1.2k"], [3_400_000, "3.4M"], [2_000_000_000, "2B"], [0.5, "0.5"], [-2500, "-2.5k"]])("%d -> %s", (n, s) => expect(compact(n)).toBe(s));
});

describe("timeTicks", () => {
  const H = 3_600_000;
  it("picks the smallest step that gives at most 8 ticks, on round hours", () => {
    const t = timeTicks(0, 24 * H);
    expect(t.length).toBeLessThanOrEqual(8);
    expect(t.every((v) => v % (6 * H) === 0)).toBe(true);
  });
  it("covers a week with day-sized steps", () => expect(timeTicks(0, 7 * 24 * H).length).toBeLessThanOrEqual(8));
  it("stays inside the window and handles a tiny one", () => {
    expect(timeTicks(10 * H + 1, 11 * H).every((v) => v >= 10 * H + 1 && v <= 11 * H)).toBe(true);
    expect(timeTicks(5, 5)).toEqual([]);
  });
});
