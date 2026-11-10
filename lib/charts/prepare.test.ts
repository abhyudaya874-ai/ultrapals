import { describe, expect, it } from "vitest";
import { boxGroups, candleRows, heatGrid, needsRightAxis, pyramidRows, scatterPoints, seriesRows, slices, tree, waterfallSteps } from "./prepare";
import { ChartSpec, type Row } from "./spec";

const S = (o: Partial<ChartSpec> & { type: ChartSpec["type"]; data: Row[] }) => ChartSpec.parse(o);

describe("seriesRows", () => {
  it("numbers the y columns and keeps nulls as null", () => {
    expect(seriesRows(S({ type: "line", x: "k", y: ["a"], data: [{ k: "p", a: 1 }, { k: "q", a: null }, { k: "r", a: "3" }] }))).toEqual([{ x: "p", a: 1 }, { x: "q", a: null }, { x: "r", a: 3 }]);
  });
  it("sorts dates oldest first and trims them", () => {
    const rows = seriesRows(S({ type: "line", x: "d", y: ["v"], data: [{ d: "2026-11-03T10:00:00Z", v: 3 }, { d: "2026-11-01T10:00:00Z", v: 1 }, { d: "2026-11-02T10:00:00Z", v: 2 }] }));
    expect(rows.map((r) => [r.x, r.v])).toEqual([["2026-11-01 10:00", 1], ["2026-11-02 10:00", 2], ["2026-11-03 10:00", 3]]);
  });
  it("does not reorder categories", () => expect(seriesRows(S({ type: "bar", x: "k", y: ["a"], data: [{ k: "z", a: 1 }, { k: "a", a: 2 }] })).map((r) => r.x)).toEqual(["z", "a"]));
});

describe("scatterPoints", () => {
  it("keeps rows with both numbers, adds size and a name", () => {
    const pts = scatterPoints(S({ type: "bubble", x: "c", y: ["f"], size: "r", data: [{ n: "Stripe", c: 3, f: 80, r: 20 }, { n: "Bad", c: null, f: 5, r: 1 }, { n: "Sq", c: 4, f: 60, r: 35 }] }));
    expect(pts).toEqual([{ x: 3, y: 80, z: 20, name: "Stripe" }, { x: 4, y: 60, z: 35, name: "Sq" }]);
  });
});

describe("slices", () => {
  it("drops zero, negative and non-numeric values, names blanks", () => {
    expect(slices(S({ type: "pie", x: "k", y: ["v"], data: [{ k: "a", v: 3 }, { k: "b", v: 0 }, { k: "c", v: -1 }, { k: "d", v: "x" }, { k: null, v: 2 }] }))).toEqual([{ name: "a", value: 3 }, { name: "(blank)", value: 2 }]);
  });
});

describe("candleRows", () => {
  it("builds candles in date order and repairs a high or low that the open/close exceed", () => {
    const c = candleRows(S({ type: "candlestick", x: "d", y: ["o", "h", "l", "c"], data: [{ d: "2026-11-02", o: 5, h: 4, l: 6, c: 7 }, { d: "2026-11-01", o: 1, h: 3, l: 0, c: 2 }, { d: "2026-11-03", o: null, h: 1, l: 1, c: 1 }] }));
    expect(c.names).toEqual(["2026-11-01", "2026-11-02"]);
    expect(c.candles[1]).toMatchObject({ open: 5, close: 7, high: 7, low: 5 });
  });
});

describe("waterfallSteps", () => {
  it("treats a Total row as the running total", () => {
    expect(waterfallSteps(S({ type: "waterfall", x: "k", y: ["v"], data: [{ k: "Promised", v: 100 }, { k: "Released", v: -30 }, { k: "Total captured", v: 0 }, { k: "bad", v: "x" }] }))).toEqual([{ label: "Promised", value: 100 }, { label: "Released", value: -30 }, { label: "Total captured", value: 0, total: true }]);
  });
});

describe("heatGrid", () => {
  it("builds rows and columns in order of appearance, scales 0..1, leaves gaps null", () => {
    const g = heatGrid(S({ type: "heatmap", x: "need", by: "rail", y: ["v"], data: [{ rail: "S", need: "fx", v: 0 }, { rail: "S", need: "tax", v: 10 }, { rail: "P", need: "fx", v: 5 }] }));
    expect(g.rows).toEqual(["S", "P"]);
    expect(g.cols).toEqual(["fx", "tax"]);
    expect(g.values).toEqual([[0, 1], [0.5, null]]);
    expect(g.raw[1]).toEqual([5, null]);
  });
  it("one flat value does not divide by zero", () => {
    expect(heatGrid(S({ type: "heatmap", x: "c", by: "r", y: ["v"], data: [{ r: "a", c: "x", v: 4 }, { r: "a", c: "y", v: 4 }] })).values).toEqual([[0.5, 0.5]]);
  });
});

describe("boxGroups / pyramidRows", () => {
  it("skips groups with a missing statistic", () => {
    expect(boxGroups(S({ type: "boxplot", x: "g", y: ["a", "b", "c", "d", "e"], data: [{ g: "ok", a: 1, b: 2, c: 3, d: 4, e: 5 }, { g: "bad", a: 1, b: null, c: 3, d: 4, e: 5 }] })).map((g) => g.label)).toEqual(["ok"]);
  });
  it("makes the left side negative", () => {
    expect(pyramidRows(S({ type: "pyramid", x: "age", y: ["m", "f"], data: [{ age: "0-9", m: 5, f: 6 }] }))).toEqual([{ x: "0-9", left: -5, right: 6 }]);
  });
});

describe("tree", () => {
  const data: Row[] = [{ n: "a", g: "X", v: 3 }, { n: "b", g: "X", v: 2 }, { n: "c", g: "Y", v: 5 }, { n: "z", g: "Y", v: 0 }];
  it("groups children under their parent and drops empty leaves", () => {
    expect(tree(S({ type: "sunburst", x: "n", by: "g", y: ["v"], data }))).toEqual([{ name: "X", children: [{ name: "a", value: 3 }, { name: "b", value: 2 }] }, { name: "Y", children: [{ name: "c", value: 5 }] }]);
  });
  it("without a parent column it is a flat list", () => expect(tree(S({ type: "treemap", x: "n", y: ["v"], data }))).toHaveLength(3));
});

describe("needsRightAxis", () => {
  it.each([[[{ a: 100, b: 90 }], false], [[{ a: 1000, b: 5 }], true], [[{ a: 80, b: 10 }], false], [[{ a: 0, b: 0 }], false]] as const)("%j -> %s", (data, want) => {
    expect(needsRightAxis(S({ type: "composed", x: "k", y: ["a", "b"], data: data.map((d) => ({ k: "x", ...d })) }))).toBe(want);
  });
});
