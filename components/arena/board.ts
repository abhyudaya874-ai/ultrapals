/** Pure maths for a board of panels that can be resized by their dividers and rearranged. No DOM here, so it can be tested. */

/** Smallest a panel may be, in px: below this its tabs and text stop being readable. */
export const PANEL_MIN_W = 340;

/** How many columns `n` panels use in a board `width` px wide: 2 side by side, 3 across for 3, a 2 by 2 for 4, three across for 5 and 6. */
export function columnsFor(n: number, width: number): number {
  if (n <= 1) return 1;
  const fit = Math.max(1, Math.floor(width / PANEL_MIN_W));
  const want = n === 2 || n === 4 ? 2 : 3;
  return Math.max(1, Math.min(want, fit));
}
export const rowsFor = (n: number, cols: number): number => Math.max(1, Math.ceil(n / Math.max(1, cols)));
export const evenWeights = (k: number): number[] => Array.from({ length: Math.max(1, k) }, () => 1);

/**
 * The line between track `i` and track `i + 1` moved by `delta` (in the same units as the weights). The two tracks trade size and the total stays
 * the same; neither goes under `min`. A line that does not exist leaves the weights as they are.
 */
export function dragSplit(weights: readonly number[], i: number, delta: number, min = 0.35): number[] {
  if (i < 0 || i >= weights.length - 1 || !Number.isFinite(delta)) return [...weights];
  const pair = weights[i] + weights[i + 1];
  const a = Math.min(pair - min, Math.max(min, weights[i] + delta));
  const six = (n: number): number => Math.round(n * 1e6) / 1e6; // 1 - 0.4 is 0.6000000000000001: keep the weights clean
  return weights.map((w, k) => (k === i ? six(a) : k === i + 1 ? six(pair - a) : w));
}

/** Pure. Pixels dragged -> weight units, for a board whose tracks add up to `total` weight over `size` px. */
export const pxToWeight = (px: number, total: number, size: number): number => (size > 0 && Number.isFinite(px) ? (px * total) / size : 0);

/** Pure. Where each divider sits, as a share of the board (0..1): the running total of the weights before it. */
export function dividerAt(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let run = 0;
  return weights.slice(0, -1).map((w) => (run += w) / total);
}

/** Pure. Two panels trade places. An id that is not in the order leaves it alone. */
export function swap<T>(order: readonly T[], a: T, b: T): T[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0 || i === j) return [...order];
  const out = [...order];
  out[i] = b;
  out[j] = a;
  return out;
}

/** Pure. Keeps the order a person made for the panels still there and adds new ones at the end, so a panel that arrives never reshuffles the rest. */
export function syncOrder(order: readonly string[], ids: readonly string[]): string[] {
  const have = new Set(ids);
  const kept = order.filter((id) => have.has(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}
