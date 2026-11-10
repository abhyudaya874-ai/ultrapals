import { z } from "zod";

/**
 * Charts are described, not drawn, by whatever produced them. A model may choose WHICH chart suits a table and which columns go where, but the
 * numbers always come from the table itself, and `resolveSpec` checks the choice fits the data (a pie of negative values does not) and falls back to
 * a rule-based pick when it does not. Pure and client-safe: no DOM, no clock.
 */
export const CHART_TYPES = [
  "line", "area", "stacked-area", "percent-area",
  "bar", "stacked-bar", "horizontal-bar", "composed",
  "scatter", "bubble",
  "pie", "donut", "radar", "radial-bar", "funnel",
  "treemap", "sunburst",
  "candlestick", "waterfall", "heatmap", "boxplot", "pyramid",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const MAX_ROWS = 200;
export const MAX_KEYS = 14;
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export const ChartSpec = z.object({
  type: z.enum(CHART_TYPES),
  title: z.string().trim().max(100).optional(),
  /** One sentence on why this chart fits the data (shown under the chart). */
  why: z.string().trim().max(240).optional(),
  /** Column for the horizontal axis, the slice names, the radar axes or the heatmap columns. */
  x: z.string().max(60).optional(),
  /** Numeric columns drawn as series. Some types read fixed positions (candlestick: open, high, low, close; boxplot: min, q1, median, q3, max). */
  y: z.array(z.string().max(60)).max(MAX_KEYS).default([]),
  /** Second grouping column: heatmap rows, sunburst parents. */
  by: z.string().max(60).optional(),
  /** Numeric column for bubble size. */
  size: z.string().max(60).optional(),
  data: z.array(z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.null()]))).max(MAX_ROWS),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

/* ───────────────────────── reading a table ───────────────────────── */

const NUM = /^[-+]?[$€£]?\d[\d,]*(\.\d+)?%?$/;
/** Pure. "2.9%", "$1,200.50", "-3" -> a number; anything else -> null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!NUM.test(s)) return null;
  const n = Number(s.replace(/[$€£,%+]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const ISO = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** Pure. ISO dates and datetimes only: "2026-11-10", "2026-11-10T09:00:00Z". */
export const isTime = (v: unknown): boolean => typeof v === "string" && ISO.test(v.trim()) && Number.isFinite(Date.parse(v.trim()));

export type Kind = "number" | "time" | "category" | "text";
export interface ColumnProfile {
  key: string;
  kind: Kind;
  distinct: number;
  nulls: number;
  min?: number;
  max?: number;
  hasNegative?: boolean;
  sample: string[];
}
export interface DataProfile {
  rows: number;
  columns: ColumnProfile[];
}

/** Pure. What each column holds. A column is numeric (or a date) when at least 80% of its filled cells are. */
export function profileData(data: readonly Row[]): DataProfile {
  const keys = [...new Set(data.flatMap((r) => Object.keys(r)))].slice(0, MAX_KEYS);
  const columns = keys.map((key): ColumnProfile => {
    const vals = data.map((r) => r[key] ?? null);
    const filled = vals.filter((v) => v !== null && v !== "");
    const nums = filled.map(toNumber).filter((n): n is number => n !== null);
    const times = filled.filter(isTime);
    const distinct = new Set(filled.map(String)).size;
    const base = { key, distinct, nulls: vals.length - filled.length, sample: [...new Set(filled.map((v) => String(v).slice(0, 30)))].slice(0, 4) };
    if (filled.length > 0 && times.length / filled.length >= 0.8) return { ...base, kind: "time" };
    if (filled.length > 0 && nums.length / filled.length >= 0.8) return { ...base, kind: "number", min: Math.min(...nums), max: Math.max(...nums), hasNegative: nums.some((n) => n < 0) };
    const avgLen = filled.length ? filled.reduce<number>((a, v) => a + String(v).length, 0) / filled.length : 0;
    return { ...base, kind: avgLen > 40 || (filled.length > 6 && distinct === filled.length && avgLen > 24) ? "text" : "category" };
  });
  return { rows: data.length, columns };
}

/** Pure. Turns parsed CSV rows (header first) into typed rows: numeric-looking cells in numeric columns become numbers; empty cells become null. Capped. */
export function rowsFromTable(table: readonly (readonly string[])[], maxRows = MAX_ROWS): Row[] {
  if (table.length < 2) return [];
  const head = table[0].map((h, i) => (h.trim() || `col${i + 1}`).slice(0, 60)).slice(0, MAX_KEYS);
  const raw = table.slice(1, maxRows + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim() || null] as const)) as Record<string, string | null>);
  const numeric = new Set(profileData(raw).columns.filter((c) => c.kind === "number").map((c) => c.key));
  return raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numeric.has(k) && v !== null ? toNumber(v) : v])));
}

/* ───────────────────────── checking a choice ───────────────────────── */

const col = (p: DataProfile, k: string | undefined) => (k ? p.columns.find((c) => c.key === k) : undefined);
const numeric = (p: DataProfile, k: string | undefined) => col(p, k)?.kind === "number";
const nonNeg = (p: DataProfile, k: string | undefined) => numeric(p, k) && !(col(p, k)?.hasNegative ?? false);

/** Pure. Why a spec cannot be drawn as asked (an empty list means it fits). Every message names the column or limit, so it can go back to a model. */
export function problems(spec: ChartSpec): string[] {
  const out: string[] = [];
  const p = profileData(spec.data);
  const t = spec.type;
  if (spec.data.length === 0) return ["there are no rows"];
  const need = (cond: boolean, msg: string) => { if (!cond) out.push(msg); };
  const hasX = !!col(p, spec.x);
  need(hasX, `x column "${spec.x ?? ""}" does not exist`);
  for (const k of spec.y) need(numeric(p, k), `y column "${k}" is not numeric`);
  const ys = spec.y.length;
  switch (t) {
    case "line": case "area": case "bar": case "horizontal-bar":
      need(ys >= 1, "needs at least one numeric y column");
      break;
    case "stacked-bar": need(ys >= 2, "stacking needs at least two numeric y columns"); break;
    case "stacked-area": case "percent-area": case "composed":
      need(ys >= 2, `${t} needs at least two numeric y columns`);
      if (t === "percent-area") for (const k of spec.y) need(nonNeg(p, k), `percent-area cannot include negative values (${k})`);
      break;
    case "scatter": need(numeric(p, spec.x) && ys >= 1, "scatter needs a numeric x column and a numeric y column"); break;
    case "bubble": need(numeric(p, spec.x) && ys >= 1 && numeric(p, spec.size), "bubble needs numeric x, y and size columns"); break;
    case "pie": case "donut": case "funnel": case "radial-bar": case "treemap":
      need(ys === 1, `${t} reads exactly one numeric y column`);
      need(nonNeg(p, spec.y[0]), `${t} cannot show negative values`);
      if (t === "pie" || t === "donut") need(spec.data.length <= 12, "more than 12 slices is unreadable");
      if (t === "radial-bar") need(spec.data.length <= 10, "more than 10 rings is unreadable");
      if (t === "funnel") need(spec.data.length >= 2 && spec.data.length <= 10, "a funnel needs 2 to 10 stages");
      break;
    case "radar":
      need(ys >= 1, "needs at least one numeric y column");
      need(spec.data.length >= 3 && spec.data.length <= 12, "a radar needs 3 to 12 axes (rows)");
      for (const k of spec.y) need(nonNeg(p, k), `radar cannot include negative values (${k})`);
      break;
    case "sunburst":
      need(ys === 1 && nonNeg(p, spec.y[0]), "sunburst reads one non-negative numeric y column");
      need(!!col(p, spec.by), `by column "${spec.by ?? ""}" (the parent) does not exist`);
      break;
    case "candlestick": need(ys === 4, "candlestick needs y = [open, high, low, close]"); break;
    case "boxplot": need(ys === 5, "boxplot needs y = [min, q1, median, q3, max]"); break;
    case "waterfall": need(ys === 1, "waterfall reads one numeric y column of changes"); break;
    case "heatmap":
      need(ys === 1, "heatmap reads one numeric y column");
      need(!!col(p, spec.by), `by column "${spec.by ?? ""}" (the rows) does not exist`);
      break;
    case "pyramid": need(ys === 2 && nonNeg(p, spec.y[0]) && nonNeg(p, spec.y[1]), "a pyramid needs two non-negative numeric y columns"); break;
  }
  return out;
}

/* ───────────────────────── choosing without a model ───────────────────────── */

const lc = (s: string) => s.toLowerCase();
const find = (p: DataProfile, ...names: string[]) => names.map((n) => p.columns.find((c) => lc(c.key) === n)?.key);

/**
 * Pure. A sensible chart for a table from its shape alone: dates become lines or areas, shares of a whole become donuts, a few categories become
 * bars, two measures become a scatter, and so on. This is the fallback when a model's choice does not fit, and the pick when no model is asked.
 */
export function suggestSpec(data: readonly Row[], title?: string): ChartSpec {
  const base = { data: data.slice(0, MAX_ROWS) as Row[], title };
  const p = profileData(base.data);
  const nums = p.columns.filter((c) => c.kind === "number");
  const times = p.columns.filter((c) => c.kind === "time");
  const cats = p.columns.filter((c) => c.kind === "category");
  const ohlc = find(p, "open", "high", "low", "close");
  if (ohlc.every(Boolean)) return ChartSpec.parse({ ...base, type: "candlestick", x: times[0]?.key ?? cats[0]?.key ?? p.columns[0]?.key, y: ohlc });
  const box = find(p, "min", "q1", "median", "q3", "max");
  if (box.every(Boolean)) return ChartSpec.parse({ ...base, type: "boxplot", x: (cats[0] ?? times[0])?.key ?? p.columns[0]?.key, y: box });
  if (times.length > 0 && nums.length > 0) {
    const y = nums.slice(0, 4).map((c) => c.key);
    return ChartSpec.parse({ ...base, type: y.length === 1 ? "area" : "line", x: times[0].key, y });
  }
  if (cats.length >= 2 && nums.length === 1 && cats[0].distinct <= 14 && cats[1].distinct <= 14 && p.rows >= 6) {
    return ChartSpec.parse({ ...base, type: "heatmap", x: cats[1].key, by: cats[0].key, y: [nums[0].key] });
  }
  if (cats.length >= 1 && nums.length >= 1) {
    const x = cats[0].key;
    const y = nums.slice(0, 4).map((c) => c.key);
    const allPositive = y.every((k) => !(col(p, k)?.hasNegative));
    if (y.length === 1 && allPositive && p.rows >= 2 && p.rows <= 6) return ChartSpec.parse({ ...base, type: "donut", x, y });
    if (y.length >= 3 && allPositive && p.rows >= 3 && p.rows <= 8) return ChartSpec.parse({ ...base, type: "radar", x, y });
    if (p.rows > 12) return ChartSpec.parse({ ...base, data: topRows(base.data, y[0], 15), type: "horizontal-bar", x, y: [y[0]] });
    return ChartSpec.parse({ ...base, type: "bar", x, y });
  }
  if (nums.length >= 3) return ChartSpec.parse({ ...base, type: "bubble", x: nums[0].key, y: [nums[1].key], size: nums[2].key });
  if (nums.length === 2) return ChartSpec.parse({ ...base, type: "scatter", x: nums[0].key, y: [nums[1].key] });
  if (nums.length === 1) return ChartSpec.parse({ ...base, type: "bar", x: p.columns.find((c) => c.key !== nums[0].key)?.key ?? nums[0].key, y: [nums[0].key] });
  return ChartSpec.parse({ ...base, type: "bar", x: p.columns[0]?.key, y: [] });
}

/** Pure. The `n` rows with the largest value in `key`, largest first. */
export const topRows = (data: readonly Row[], key: string, n: number): Row[] => [...data].sort((a, b) => (toNumber(b[key]) ?? -Infinity) - (toNumber(a[key]) ?? -Infinity)).slice(0, n);

/** Pure. A pie with a long tail keeps its biggest slices and folds the rest into "Other". */
export function foldTail(data: readonly Row[], x: string, y: string, keep = 8): Row[] {
  if (data.length <= keep) return [...data];
  const sorted = topRows(data, y, data.length);
  const head = sorted.slice(0, keep - 1);
  const rest = sorted.slice(keep - 1).reduce((s, r) => s + (toNumber(r[y]) ?? 0), 0);
  return [...head, { [x]: "Other", [y]: rest }];
}

export interface Resolved {
  spec: ChartSpec;
  /** Set when the requested chart did not fit and another was drawn: says what and why. */
  note?: string;
}

/**
 * Pure. The chart that will be drawn. If the requested spec fits, it is used as is (long tails folded for pies); if not, the rule-based pick is used
 * and `note` says why, so a wrong model choice is visible to the person and never a blank or broken chart.
 */
export function resolveSpec(requested: ChartSpec): Resolved {
  const why = problems(requested);
  if (why.length === 0) {
    if ((requested.type === "pie" || requested.type === "donut") && requested.x && requested.data.length > 8) return { spec: { ...requested, data: foldTail(requested.data, requested.x, requested.y[0]) } };
    return { spec: requested };
  }
  const alt = suggestSpec(requested.data, requested.title);
  const ok = problems(alt).length === 0;
  return { spec: ok ? { ...alt, why: requested.why } : { ...alt, type: "bar" }, note: `A ${requested.type} chart did not fit (${why[0]}), so this is a ${alt.type} chart.` };
}
