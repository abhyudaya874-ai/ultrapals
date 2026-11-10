import { isTime, toNumber, type ChartSpec, type Row } from "./spec";

/** Pure data shaping for each chart type. The renderer draws what these return and does no arithmetic of its own. */

const label = (v: unknown): string => (v === null || v === undefined ? "" : isTime(v) ? String(v).slice(0, String(v).length > 10 ? 16 : 10).replace("T", " ") : String(v));

export interface Point { x: string; [series: string]: string | number | null }

/** Rows with the x label as text and every y column as a number (null when missing). Dates are sorted oldest first. */
export function seriesRows(spec: ChartSpec): Point[] {
  const timey = spec.data.length > 0 && spec.data.every((r) => r[spec.x ?? ""] === null || isTime(r[spec.x ?? ""]));
  const rows = spec.data.map((r) => ({ raw: r[spec.x ?? ""], p: { x: label(r[spec.x ?? ""]), ...Object.fromEntries(spec.y.map((k) => [k, toNumber(r[k])])) } as Point }));
  if (timey) rows.sort((a, b) => Date.parse(String(a.raw)) - Date.parse(String(b.raw)));
  return rows.map((r) => r.p);
}

export interface ScatterPoint { x: number; y: number; z?: number; name: string }
export function scatterPoints(spec: ChartSpec): ScatterPoint[] {
  const y = spec.y[0];
  return spec.data.flatMap((r) => {
    const x = toNumber(r[spec.x ?? ""]);
    const yy = toNumber(r[y]);
    if (x === null || yy === null) return [];
    const z = spec.size ? toNumber(r[spec.size]) : null;
    const name = Object.values(r).find((v) => typeof v === "string" && !isTime(v) && toNumber(v) === null);
    return [{ x, y: yy, ...(z === null ? {} : { z }), name: name === undefined ? "" : String(name) }];
  });
}

export interface Slice { name: string; value: number }
export function slices(spec: ChartSpec): Slice[] {
  return spec.data.flatMap((r) => {
    const v = toNumber(r[spec.y[0]]);
    return v === null || v <= 0 ? [] : [{ name: label(r[spec.x ?? ""]) || "(blank)", value: v }];
  });
}

/** Candles in table order. A date x column becomes the time; any other x column labels the candle. */
export function candleRows(spec: ChartSpec): { candles: { t: number; open: number; high: number; low: number; close: number; n: number }[]; names: string[] } {
  const [o, h, l, c] = spec.y;
  const rows = spec.data.flatMap((r) => {
    const v = [o, h, l, c].map((k) => toNumber(r[k]));
    return v.some((n) => n === null) ? [] : [{ x: label(r[spec.x ?? ""]), raw: r[spec.x ?? ""], open: v[0]!, high: v[1]!, low: v[2]!, close: v[3]! }];
  });
  if (rows.length > 0 && rows.every((r) => isTime(r.raw))) rows.sort((a, b) => Date.parse(String(a.raw)) - Date.parse(String(b.raw)));
  return { candles: rows.map((r, i) => ({ t: i, open: r.open, high: Math.max(r.high, r.open, r.close), low: Math.min(r.low, r.open, r.close), close: r.close, n: 1 })), names: rows.map((r) => r.x) };
}

/** Changes in table order; a row named like "Total" or "Net" shows the running total instead of adding. */
export function waterfallSteps(spec: ChartSpec): { label: string; value: number; total?: boolean }[] {
  return spec.data.flatMap((r) => {
    const v = toNumber(r[spec.y[0]]);
    const name = label(r[spec.x ?? ""]);
    return v === null ? [] : [{ label: name, value: v, ...(/^(total|net|sum|balance|result)\b/i.test(name) ? { total: true } : {}) }];
  });
}

/** Rows × columns grid scaled 0..1 (min to max of the value column); a missing pair is null. */
export function heatGrid(spec: ChartSpec): { rows: string[]; cols: string[]; values: (number | null)[][]; raw: (number | null)[][] } {
  const rows: string[] = [];
  const cols: string[] = [];
  const cell = new Map<string, number>();
  for (const r of spec.data) {
    const rr = label(r[spec.by ?? ""]);
    const cc = label(r[spec.x ?? ""]);
    const v = toNumber(r[spec.y[0]]);
    if (!rows.includes(rr)) rows.push(rr);
    if (!cols.includes(cc)) cols.push(cc);
    if (v !== null) cell.set(`${rr}\u0000${cc}`, v);
  }
  const vals = [...cell.values()];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const norm = (v: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));
  const raw = rows.map((rr) => cols.map((cc) => cell.get(`${rr}\u0000${cc}`) ?? null));
  return { rows, cols, raw, values: raw.map((row) => row.map((v) => (v === null ? null : norm(v)))) };
}

export function boxGroups(spec: ChartSpec) {
  return spec.data.flatMap((r) => {
    const v = spec.y.map((k) => toNumber(r[k]));
    if (v.some((n) => n === null)) return [];
    const [min, q1, median, q3, max] = v as number[];
    return [{ label: label(r[spec.x ?? ""]), min, q1, median, q3, max }];
  });
}

/** Left series as negative numbers so a pyramid's two sides grow in opposite directions. */
export function pyramidRows(spec: ChartSpec): { x: string; left: number; right: number }[] {
  return spec.data.map((r) => ({ x: label(r[spec.x ?? ""]), left: -(toNumber(r[spec.y[0]]) ?? 0), right: toNumber(r[spec.y[1]]) ?? 0 }));
}

export interface TreeNode { name: string; value?: number; children?: TreeNode[]; [key: string]: unknown }
/** Two levels: parents from `by`, children from `x`. Without `by`, a flat list. */
export function tree(spec: ChartSpec): TreeNode[] {
  const leaf = (r: Row): TreeNode | null => {
    const v = toNumber(r[spec.y[0]]);
    return v === null || v <= 0 ? null : { name: label(r[spec.x ?? ""]) || "(blank)", value: v };
  };
  if (!spec.by) return spec.data.flatMap((r) => { const l = leaf(r); return l ? [l] : []; });
  const groups = new Map<string, TreeNode[]>();
  for (const r of spec.data) {
    const l = leaf(r);
    if (!l) continue;
    const g = label(r[spec.by]) || "(none)";
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  return [...groups.entries()].map(([name, children]) => ({ name, children }));
}

/** A composed chart gets a second y axis when its series differ in size by more than 8x, so a small line is not flattened by big bars. */
export function needsRightAxis(spec: ChartSpec): boolean {
  const maxes = spec.y.map((k) => Math.max(0, ...spec.data.map((r) => Math.abs(toNumber(r[k]) ?? 0))));
  const big = Math.max(...maxes);
  const small = Math.min(...maxes.filter((m) => m > 0));
  return Number.isFinite(small) && big / small > 8;
}
