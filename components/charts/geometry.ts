/** Pure geometry and data shaping for the SVG charts. No DOM, no clock, no randomness: everything here is testable. */

export interface Ticks { ticks: number[]; min: number; max: number }

/** A "nice" axis: round numbers that cover [min, max] with about `count` steps. A flat series still gets a visible range. */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) ticks.push(Number((lo + i * step).toPrecision(12))); // index-based, so 0.1 steps do not drift into 0.6000000000000001
  return { ticks, min: Number(lo.toPrecision(12)), max: Number(hi.toPrecision(12)) };
}

/** Maps a value from a domain to a range (linear). A zero-width domain maps to the middle of the range. */
export const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number): number => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** Angle 0 is straight up, clockwise. */
export const polar = (cx: number, cy: number, r: number, angle: number): { x: number; y: number } => ({ x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) });

/** Radar: `values` are 0..1 per axis; returns the polygon's points and where each axis ends. */
export function radarShape(values: readonly number[], cx: number, cy: number, r: number): { points: { x: number; y: number }[]; axes: { x: number; y: number }[] } {
  const n = values.length;
  const ang = (i: number) => (i / Math.max(1, n)) * Math.PI * 2;
  return {
    points: values.map((v, i) => polar(cx, cy, r * Math.min(1, Math.max(0, v)), ang(i))),
    axes: values.map((_, i) => polar(cx, cy, r, ang(i))),
  };
}
export const pointsAttr = (pts: readonly { x: number; y: number }[]): string => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export interface Candle { t: number; open: number; high: number; low: number; close: number; n: number }
/** Groups timestamped values into buckets of `bucketMs` and reports open (first), high, low, close (last) per bucket, oldest first. */
export function toCandles(points: readonly { t: number; v: number }[], bucketMs: number): Candle[] {
  const by = new Map<number, { t: number; v: number }[]>();
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
    const k = Math.floor(p.t / bucketMs) * bucketMs;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, ps]) => {
    const s = [...ps].sort((a, b) => a.t - b.t);
    const vs = s.map((p) => p.v);
    return { t, open: s[0].v, close: s[s.length - 1].v, high: Math.max(...vs), low: Math.min(...vs), n: s.length };
  });
}

export interface WaterfallBar { label: string; from: number; to: number; kind: "start" | "up" | "down" | "total" }
/** Steps are deltas, except `total: true` which shows the running total so far. */
export function waterfall(steps: readonly { label: string; value: number; total?: boolean }[]): WaterfallBar[] {
  let run = 0;
  return steps.map((s, i) => {
    if (s.total) return { label: s.label, from: 0, to: run, kind: "total" as const };
    const from = run;
    run += s.value;
    return { label: s.label, from, to: run, kind: i === 0 ? ("start" as const) : s.value >= 0 ? ("up" as const) : ("down" as const) };
  });
}

/** SVG path for a ring segment between radii r0..r1 and angles a0..a1 (radians, 0 = up, clockwise). */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4); // a full circle cannot be one arc
  const e = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => polar(cx, cy, r, a);
  const [o0, o1, i1, i0] = [p(r1, a0), p(r1, e), p(r0, e), p(r0, a0)];
  return `M${o0.x.toFixed(2)} ${o0.y.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}L${i1.x.toFixed(2)} ${i1.y.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}Z`;
}

/** Splits a donut into arcs proportional to the values; zero and negative values take no space. */
export function donutArcs(values: readonly number[]): { a0: number; a1: number; share: number }[] {
  const pos = values.map((v) => (v > 0 && Number.isFinite(v) ? v : 0));
  const total = pos.reduce((a, b) => a + b, 0);
  let a = 0;
  return pos.map((v) => {
    const span = total === 0 ? 0 : (v / total) * Math.PI * 2;
    const arc = { a0: a, a1: a + span, share: total === 0 ? 0 : v / total };
    a += span;
    return arc;
  });
}

/** Colour for a 0..1 heat value: dark teal through teal to a warm highlight. `null` (no data) is a faint cell. */
export function heat(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return "rgba(255,255,255,0.04)";
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, [number, number, number]][] = [[0, [30, 44, 49]], [0.5, [60, 124, 134]], [1, [226, 214, 140]]];
  const i = x <= 0.5 ? 0 : 1;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const k = (x - t0) / (t1 - t0);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** A compact axis label: 1200 -> "1.2k", 3_400_000 -> "3.4M", 0.5 -> "0.5". */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
}

/** Time ticks that fit: the smallest step from this list that gives at most `max` ticks. */
export function timeTicks(from: number, to: number, max = 8): number[] {
  const H = 3_600_000;
  const step = [H, 3 * H, 6 * H, 12 * H, 24 * H, 48 * H, 7 * 24 * H].find((s) => (to - from) / s < max) ?? 7 * 24 * H;
  const out: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}
