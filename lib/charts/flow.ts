/** Pure money-flow summaries from verdict rows. Integer minor units only; amounts are never converted between currencies. */
export interface FlowRow { promiseId: string; state: string; amountMinor: number; currency: string; at: string }

/** Pure. The newest row of each promise (rows are one per verdict event, so a promise can appear many times). */
export function latestPerPromise<T extends { promiseId: string; at: string }>(rows: readonly T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const cur = m.get(r.promiseId);
    if (!cur || r.at > cur.at) m.set(r.promiseId, r);
  }
  return [...m.values()];
}

export interface Flow {
  currency: string;
  /** Promises in other currencies, left out rather than added to this one. */
  skipped: number;
  promised: number;
  captured: number;
  released: number;
  declined: number;
  open: number;
  counts: Record<string, number>;
}

const BUCKET: Record<string, "captured" | "released" | "declined" | "open"> = { captured: "captured", released: "released", declined: "declined", open: "open", capture_pending: "open" };

/** Pure. Where the money promised went. Uses the most common currency. promised = captured + released + declined + open, always. */
export function moneyFlow(rows: readonly FlowRow[]): Flow {
  const latest = latestPerPromise(rows);
  const tally = new Map<string, number>();
  for (const r of latest) tally.set(r.currency, (tally.get(r.currency) ?? 0) + 1);
  const currency = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "USD";
  const f: Flow = { currency, skipped: 0, promised: 0, captured: 0, released: 0, declined: 0, open: 0, counts: {} };
  for (const r of latest) {
    if (r.currency !== currency) { f.skipped++; continue; }
    f.counts[r.state] = (f.counts[r.state] ?? 0) + 1;
    f[BUCKET[r.state] ?? "open"] += r.amountMinor;
    f.promised += r.amountMinor;
  }
  return f;
}

/** Pure. One point per verdict event: when, and the promise amount. For a candlestick of amounts per day. */
export const amountPoints = (rows: readonly FlowRow[], currency: string): { t: number; v: number }[] =>
  rows.filter((r) => r.currency === currency && Number.isFinite(Date.parse(r.at))).map((r) => ({ t: Date.parse(r.at), v: r.amountMinor / 100 }));

/** Pure. Verdict events by weekday (0 = Sunday, UTC) × hour, as counts. For an activity heatmap. */
export function activityGrid(rows: readonly { at: string }[]): number[][] {
  const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    const d = new Date(r.at);
    if (Number.isFinite(d.getTime())) g[d.getUTCDay()][d.getUTCHours()]++;
  }
  return g;
}
