import { describe, expect, it } from "vitest";
import { CHART_TYPES, ChartSpec, foldTail, isTime, problems, profileData, resolveSpec, rowsFromTable, suggestSpec, toNumber, topRows, type Row } from "./spec";

const spec = (o: Partial<ChartSpec> & { type: ChartSpec["type"]; data: Row[] }): ChartSpec => ChartSpec.parse(o);
const rails: Row[] = [{ rail: "Stripe", fit: 82, cost: 3, risk: 20 }, { rail: "Square", fit: 64, cost: 4, risk: 35 }, { rail: "PayPal", fit: 71, cost: 5, risk: 25 }, { rail: "Adyen", fit: 40, cost: 6, risk: 10 }];
const days: Row[] = [{ day: "2026-11-01", amount: 10, runs: 2 }, { day: "2026-11-02", amount: 14, runs: 3 }, { day: "2026-11-03", amount: 9, runs: 1 }];

describe("toNumber / isTime", () => {
  it.each([["2.9%", 2.9], ["$1,200.50", 1200.5], ["-3", -3], ["+4", 4], [" 7 ", 7], [12, 12]])("%j -> %d", (v, want) => expect(toNumber(v)).toBe(want));
  it.each(["", "abc", "1.2.3", "12px", null, undefined, Number.NaN, Infinity, "0x10"])("%j is not a number", (v) => expect(toNumber(v)).toBeNull());
  it.each(["2026-11-10", "2026-11-10T09:00:00Z", "2026-11-10 09:00", "2026-11"])("%s is a time", (v) => expect(isTime(v)).toBe(true));
  it.each(["Nov 10", "yesterday", "10/11/2026", "2026-13-45", 20261110, ""])("%j is not", (v) => expect(isTime(v)).toBe(false));
});

describe("profileData", () => {
  it("tells numbers, times and categories apart, with ranges", () => {
    const p = profileData([{ d: "2026-11-01", n: 5, c: "a" }, { d: "2026-11-02", n: -2, c: "b" }, { d: "2026-11-03", n: 9, c: "a" }]);
    expect(p.columns.map((c) => [c.key, c.kind])).toEqual([["d", "time"], ["n", "number"], ["c", "category"]]);
    expect(p.columns[1]).toMatchObject({ min: -2, max: 9, hasNegative: true });
    expect(p.columns[2].distinct).toBe(2);
  });
  it("long sentences are text, and a mostly-numeric column with a few blanks is still numeric", () => {
    const long = "this is a long descriptive sentence about one thing and the other";
    expect(profileData([{ t: long }, { t: long + "x" }]).columns[0].kind).toBe("text");
    expect(profileData([{ n: 1 }, { n: null }, { n: 3 }, { n: "" }]).columns[0]).toMatchObject({ kind: "number", nulls: 2 });
  });
  it("an empty table has no columns", () => expect(profileData([])).toEqual({ rows: 0, columns: [] }));
});

describe("rowsFromTable", () => {
  it("makes numeric columns numbers, blanks null, and names blank headers", () => {
    const rows = rowsFromTable([["rail", "fee", ""], ["Stripe", "2.9%", "x"], ["Square", "3.3%", ""]]);
    expect(rows).toEqual([{ rail: "Stripe", fee: 2.9, col3: "x" }, { rail: "Square", fee: 3.3, col3: null }]);
  });
  it("needs a header and at least one row, and caps the rows", () => {
    expect(rowsFromTable([["a"]])).toEqual([]);
    expect(rowsFromTable([])).toEqual([]);
    expect(rowsFromTable([["a"], ...Array.from({ length: 500 }, (_, i) => [String(i)])])).toHaveLength(200);
  });
  it("a text column that looks numeric in a few cells stays text", () => {
    expect(rowsFromTable([["id"], ["a1"], ["b2"], ["c3"]])[0].id).toBe("a1");
  });
});

describe("problems: a spec either fits its data or says exactly why not", () => {
  const ok: [string, ChartSpec][] = [
    ["line", spec({ type: "line", x: "day", y: ["amount", "runs"], data: days })],
    ["area", spec({ type: "area", x: "day", y: ["amount"], data: days })],
    ["stacked-area", spec({ type: "stacked-area", x: "day", y: ["amount", "runs"], data: days })],
    ["percent-area", spec({ type: "percent-area", x: "day", y: ["amount", "runs"], data: days })],
    ["bar", spec({ type: "bar", x: "rail", y: ["fit"], data: rails })],
    ["stacked-bar", spec({ type: "stacked-bar", x: "rail", y: ["fit", "risk"], data: rails })],
    ["horizontal-bar", spec({ type: "horizontal-bar", x: "rail", y: ["fit"], data: rails })],
    ["composed", spec({ type: "composed", x: "rail", y: ["fit", "cost"], data: rails })],
    ["scatter", spec({ type: "scatter", x: "cost", y: ["fit"], data: rails })],
    ["bubble", spec({ type: "bubble", x: "cost", y: ["fit"], size: "risk", data: rails })],
    ["pie", spec({ type: "pie", x: "rail", y: ["fit"], data: rails })],
    ["donut", spec({ type: "donut", x: "rail", y: ["fit"], data: rails })],
    ["radar", spec({ type: "radar", x: "rail", y: ["fit", "risk"], data: rails })],
    ["radial-bar", spec({ type: "radial-bar", x: "rail", y: ["fit"], data: rails })],
    ["funnel", spec({ type: "funnel", x: "rail", y: ["fit"], data: rails })],
    ["treemap", spec({ type: "treemap", x: "rail", y: ["fit"], data: rails })],
    ["sunburst", spec({ type: "sunburst", x: "rail", by: "grp", y: ["fit"], data: rails.map((r, i) => ({ ...r, grp: i < 2 ? "A" : "B" })) })],
    ["candlestick", spec({ type: "candlestick", x: "day", y: ["o", "h", "l", "c"], data: [{ day: "2026-11-01", o: 1, h: 3, l: 0, c: 2 }, { day: "2026-11-02", o: 2, h: 4, l: 1, c: 3 }] })],
    ["boxplot", spec({ type: "boxplot", x: "g", y: ["a", "b", "c", "d", "e"], data: [{ g: "x", a: 1, b: 2, c: 3, d: 4, e: 5 }] })],
    ["waterfall", spec({ type: "waterfall", x: "rail", y: ["fit"], data: rails })],
    ["heatmap", spec({ type: "heatmap", x: "need", by: "rail", y: ["v"], data: [{ rail: "S", need: "fx", v: 1 }, { rail: "S", need: "tax", v: 0 }] })],
    ["pyramid", spec({ type: "pyramid", x: "rail", y: ["fit", "risk"], data: rails })],
  ];
  it("covers every chart type", () => expect(ok.map(([t]) => t).sort()).toEqual([...CHART_TYPES].sort()));
  it.each(ok)("%s fits its data", (_t, s) => expect(problems(s)).toEqual([]));

  const bad: [string, ChartSpec, RegExp][] = [
    ["a missing x column", spec({ type: "bar", x: "nope", y: ["fit"], data: rails }), /x column "nope"/],
    ["a text y column", spec({ type: "bar", x: "rail", y: ["rail"], data: rails }), /"rail" is not numeric/],
    ["no rows", spec({ type: "bar", x: "rail", y: ["fit"], data: [] }), /no rows/],
    ["a pie of negative values", spec({ type: "pie", x: "d", y: ["v"], data: [{ d: "a", v: 5 }, { d: "b", v: -2 }] }), /negative/],
    ["a pie with two series", spec({ type: "pie", x: "rail", y: ["fit", "risk"], data: rails }), /exactly one/],
    ["a stacked bar with one series", spec({ type: "stacked-bar", x: "rail", y: ["fit"], data: rails }), /at least two/],
    ["a radar with two axes", spec({ type: "radar", x: "rail", y: ["fit"], data: rails.slice(0, 2) }), /3 to 12 axes/],
    ["a scatter with a text x", spec({ type: "scatter", x: "rail", y: ["fit"], data: rails }), /numeric x/],
    ["a bubble without size", spec({ type: "bubble", x: "cost", y: ["fit"], data: rails }), /size/],
    ["a candlestick with three columns", spec({ type: "candlestick", x: "rail", y: ["fit", "cost", "risk"], data: rails }), /open, high, low, close/],
    ["a heatmap without rows column", spec({ type: "heatmap", x: "rail", y: ["fit"], data: rails }), /by column/],
    ["a funnel of one stage", spec({ type: "funnel", x: "rail", y: ["fit"], data: rails.slice(0, 1) }), /2 to 10 stages/],
    ["a percent-area with negatives", spec({ type: "percent-area", x: "d", y: ["a", "b"], data: [{ d: "2026-11-01", a: 1, b: -1 }, { d: "2026-11-02", a: 2, b: 2 }] }), /negative/],
    ["a pie of 13 slices", spec({ type: "pie", x: "k", y: ["v"], data: Array.from({ length: 13 }, (_, i) => ({ k: `s${i}`, v: i + 1 })) }), /12 slices/],
  ];
  it.each(bad)("refuses %s and says why", (_n, s, re) => expect(problems(s).join(" | ")).toMatch(re));
});

describe("suggestSpec: the rule-based pick", () => {
  it.each([
    ["dates and numbers -> line", days, "line"],
    ["dates and one number -> area", days.map((d) => ({ day: d.day, amount: d.amount })), "area"],
    ["a few categories and one positive number -> donut", rails.map((r) => ({ rail: r.rail, fit: r.fit })), "donut"],
    ["several categories and several measures -> radar", rails, "radar"],
    ["many categories -> horizontal bars of the top 15", Array.from({ length: 30 }, (_, i) => ({ k: `item${i}`, v: i })), "horizontal-bar"],
    ["two measures and no categories -> scatter", rails.map((r) => ({ cost: r.cost, fit: r.fit })), "scatter"],
    ["three measures and no categories -> bubble", rails.map((r) => ({ cost: r.cost, fit: r.fit, risk: r.risk })), "bubble"],
    ["open/high/low/close -> candlestick", [{ day: "2026-11-01", open: 1, high: 3, low: 0, close: 2 }, { day: "2026-11-02", open: 2, high: 4, low: 1, close: 3 }], "candlestick"],
    ["two categories and a value -> heatmap", ["a", "b", "c"].flatMap((r) => ["x", "y", "z"].map((c) => ({ row: r, col: c, v: r.length + c.length }))), "heatmap"],
  ])("%s", (_n, data, want) => {
    const s = suggestSpec(data);
    expect(s.type).toBe(want);
    expect(problems(s)).toEqual([]);
  });
  it("keeps only the top 15 for a long list, largest first", () => {
    const s = suggestSpec(Array.from({ length: 30 }, (_, i) => ({ k: `item${i}`, v: i })));
    expect(s.data).toHaveLength(15);
    expect(s.data[0]).toEqual({ k: "item29", v: 29 });
  });
  it("never throws and always parses, whatever it is given", () => {
    for (const data of [[], [{ a: null }], [{ a: "x" }], [{ a: 1 }], [{ a: 1, b: 2 }], Array.from({ length: 300 }, (_, i) => ({ a: i, b: `c${i}` }))] as Row[][]) {
      const s = suggestSpec(data);
      expect(ChartSpec.safeParse(s).success).toBe(true);
      expect(s.data.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("foldTail / topRows", () => {
  it("keeps the biggest slices and folds the rest into Other", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ k: `s${i}`, v: i + 1 }));
    const f = foldTail(data, "k", "v", 5);
    expect(f.map((r) => r.k)).toEqual(["s11", "s10", "s9", "s8", "Other"]);
    expect(f.at(-1)!.v).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7 + 8);
    expect(foldTail(data.slice(0, 4), "k", "v", 5)).toHaveLength(4);
  });
  it("topRows ignores non-numbers", () => expect(topRows([{ v: "x" }, { v: 3 }, { v: 9 }], "v", 2)).toEqual([{ v: 9 }, { v: 3 }]));
});

describe("resolveSpec: a model's choice is only used if it fits", () => {
  it("a fitting choice passes through untouched", () => {
    const s = spec({ type: "radar", x: "rail", y: ["fit", "risk"], data: rails, why: "compares rails across measures" });
    expect(resolveSpec(s)).toEqual({ spec: s });
  });
  it("a pie of negatives is replaced, with a note that names the reason", () => {
    const r = resolveSpec(spec({ type: "pie", x: "d", y: ["v"], data: [{ d: "a", v: 5 }, { d: "b", v: -2 }, { d: "c", v: 4 }], why: "shares" }));
    expect(r.spec.type).not.toBe("pie");
    expect(r.note).toMatch(/pie chart did not fit \(.*negative.*\)/);
    expect(problems(r.spec)).toEqual([]);
    expect(r.spec.why).toBe("shares");
  });
  it("a pie with a long tail folds it", () => {
    const r = resolveSpec(spec({ type: "pie", x: "k", y: ["v"], data: Array.from({ length: 11 }, (_, i) => ({ k: `s${i}`, v: i + 1 })) }));
    expect(r.spec.data).toHaveLength(8);
    expect(r.spec.data.at(-1)).toMatchObject({ k: "Other" });
  });
  it("a column that does not exist falls back to a rule-based chart that does", () => {
    const r = resolveSpec(spec({ type: "line", x: "nope", y: ["ghost"], data: rails }));
    expect(r.note).toBeDefined();
    expect(problems(r.spec)).toEqual([]);
  });
  it("an empty table still returns a spec instead of throwing", () => {
    const r = resolveSpec(spec({ type: "bar", x: "a", y: ["b"], data: [] }));
    expect(r.spec.data).toEqual([]);
    expect(r.note).toMatch(/no rows/);
  });
});
