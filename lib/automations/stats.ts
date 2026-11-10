import { nextRunAfter, type Automation, type Schedule } from "./core";

export const DAY = 86_400_000;
export const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

type RunLite = { atMs: number; ms: number; status: "ok" | "error"; agents?: string[] };
type AutoLite = { name: string; runs: readonly RunLite[] };

/** Pure. Automations × the last `days` UTC days: the share of runs that succeeded that day (null = no run). Oldest day first. */
export function runGrid(autos: readonly AutoLite[], now: number, days = 14): { rows: string[]; cols: string[]; values: (number | null)[][]; counts: number[][] } {
  const first = dayStart(now) - (days - 1) * DAY;
  const cols = Array.from({ length: days }, (_, i) => new Date(first + i * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
  const counts = autos.map((a) => Array.from({ length: days }, (_, i) => a.runs.filter((r) => dayStart(r.atMs) === first + i * DAY).length));
  const values = autos.map((a) => Array.from({ length: days }, (_, i) => {
    const day = a.runs.filter((r) => dayStart(r.atMs) === first + i * DAY);
    return day.length === 0 ? null : day.filter((r) => r.status === "ok").length / day.length;
  }));
  return { rows: autos.map((a) => a.name), cols, values, counts };
}

/** Pure. One point per finished run: when it started and how many seconds it took. For a candlestick of durations per day. */
export const durationPoints = (autos: readonly AutoLite[]): { t: number; v: number }[] =>
  autos.flatMap((a) => a.runs.map((r) => ({ t: r.atMs, v: Math.round(r.ms / 100) / 10 })));

export interface Kpis { active: number; total: number; runs24h: number; ok24h: number; failed24h: number; successRate: number | null; next: { name: string; at: number } | null }
export function kpis(autos: readonly (AutoLite & { enabled: boolean; nextRunMs: number | null })[], now: number): Kpis {
  const recent = autos.flatMap((a) => a.runs.filter((r) => now - r.atMs < DAY && r.atMs <= now));
  const ok = recent.filter((r) => r.status === "ok").length;
  const upcoming = autos.filter((a) => a.enabled && a.nextRunMs !== null).map((a) => ({ name: a.name, at: a.nextRunMs! })).sort((x, y) => x.at - y.at);
  return { active: autos.filter((a) => a.enabled).length, total: autos.length, runs24h: recent.length, ok24h: ok, failed24h: recent.length - ok, successRate: recent.length ? ok / recent.length : null, next: upcoming[0] ?? null };
}

/** Pure. When an automation will run between `from` and `to` if nothing changes, starting from its recorded next run. Capped, so a 30-minute schedule over a week is still bounded. */
export function upcomingRuns(a: Pick<Automation, "schedule" | "tzOffsetMin" | "nextRunMs" | "enabled">, from: number, to: number, cap = 60): number[] {
  if (!a.enabled || a.nextRunMs === null) return [];
  const out: number[] = [];
  let t = Math.max(a.nextRunMs, from);
  while (t <= to && out.length < cap) {
    out.push(t);
    t = nextRunAfter(a.schedule as Schedule, a.tzOffsetMin, t);
  }
  return out;
}
