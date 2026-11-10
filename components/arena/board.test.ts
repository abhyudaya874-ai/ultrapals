import { describe, expect, it } from "vitest";
import { PANEL_MIN_W, columnsFor, dividerAt, dragSplit, evenWeights, pxToWeight, rowsFor, swap, syncOrder } from "./board";

describe("columnsFor / rowsFor", () => {
  it.each([[1, 1600, 1], [2, 1600, 2], [3, 1600, 3], [4, 1600, 2], [5, 1600, 3], [6, 1600, 3]])("%i panels on a wide screen use %i columns", (n, w, cols) => expect(columnsFor(n, w)).toBe(cols));
  it("fewer columns when the board is narrow, never fewer than one", () => {
    expect(columnsFor(6, PANEL_MIN_W * 2)).toBe(2);
    expect(columnsFor(3, PANEL_MIN_W + 10)).toBe(1);
    expect(columnsFor(4, 0)).toBe(1);
  });
  it("rows follow", () => {
    expect(rowsFor(4, 2)).toBe(2);
    expect(rowsFor(5, 3)).toBe(2);
    expect(rowsFor(1, 1)).toBe(1);
    expect(rowsFor(3, 0)).toBe(3);
  });
});

describe("dragSplit", () => {
  it("trades size between the two tracks and keeps the total", () => {
    const w = dragSplit([1, 1, 1], 0, 0.4);
    expect(w).toEqual([1.4, 0.6, 1]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 10);
  });
  it("neither track goes below the minimum", () => {
    expect(dragSplit([1, 1], 0, 5, 0.35)).toEqual([1.65, 0.35]);
    expect(dragSplit([1, 1], 0, -5, 0.35)).toEqual([0.35, 1.65]);
  });
  it("leaves the weights alone for a line that does not exist or a bad number", () => {
    expect(dragSplit([1, 1], 1, 0.5)).toEqual([1, 1]);
    expect(dragSplit([1, 1], -1, 0.5)).toEqual([1, 1]);
    expect(dragSplit([1], 0, 0.5)).toEqual([1]);
    expect(dragSplit([1, 1], 0, Number.NaN)).toEqual([1, 1]);
  });
  it("returns a copy", () => {
    const w = [1, 1];
    expect(dragSplit(w, 0, 0)).not.toBe(w);
  });
});

describe("pxToWeight / dividerAt", () => {
  it("a drag across the whole board moves all the weight", () => expect(pxToWeight(600, 2, 600)).toBe(2));
  it("a board with no size moves nothing", () => {
    expect(pxToWeight(10, 2, 0)).toBe(0);
    expect(pxToWeight(Number.NaN, 2, 600)).toBe(0);
  });
  it("dividers sit at the running share of the board", () => {
    expect(dividerAt([1, 1, 1])).toEqual([1 / 3, 2 / 3]);
    expect(dividerAt([2, 1])).toEqual([2 / 3]);
    expect(dividerAt([1])).toEqual([]);
  });
  it("evenWeights is at least one track", () => {
    expect(evenWeights(3)).toEqual([1, 1, 1]);
    expect(evenWeights(0)).toEqual([1]);
  });
});

describe("swap / syncOrder", () => {
  it("two panels trade places", () => expect(swap(["a", "b", "c"], "a", "c")).toEqual(["c", "b", "a"]));
  it("an unknown id or the same id changes nothing", () => {
    expect(swap(["a", "b"], "a", "z")).toEqual(["a", "b"]);
    expect(swap(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
  it("keeps the person's order and puts new panels last", () => {
    expect(syncOrder(["c", "a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });
  it("drops panels that are gone", () => expect(syncOrder(["c", "a", "b"], ["a", "b"])).toEqual(["a", "b"]));
  it("starts from the given order when there was none", () => expect(syncOrder([], ["a", "b"])).toEqual(["a", "b"]));
});
