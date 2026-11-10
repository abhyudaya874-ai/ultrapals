import { z } from "zod";
import type { ProbeRow } from "@/lib/pals/probe";

/** The closed list of jobs Proctor may run on a timetable. A new job is a code change with its own tests, never a model decision. */
export const JobId = z.enum(["sandbox_canary"]);
export type JobId = z.infer<typeof JobId>;
export const Schedule = z.object({
  job: JobId,
  everyMs: z.number().int().min(60_000), // never faster than one minute
  dailyCases: z.number().int().min(0).max(50), // at most this many cases opened per UTC day
  quiet: z.object({ fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(0).max(23) }).optional(), // UTC hours when no case is opened
});
export type Schedule = z.infer<typeof Schedule>;
export const DEFAULT_SCHEDULES: Schedule[] = [{ job: "sandbox_canary", everyMs: 6 * 3_600_000, dailyCases: 3 }];

/** Pure. Jobs whose interval has elapsed. A job that never ran is due. nowMs is a parameter: there is no clock in here. */
export function dueJobs(schedules: readonly Schedule[], lastRunMs: Readonly<Partial<Record<JobId, number>>>, nowMs: number): JobId[] {
  return schedules.filter((s) => lastRunMs[s.job] === undefined || nowMs - (lastRunMs[s.job] as number) >= s.everyMs).map((s) => s.job);
}

export type Change = "baseline" | "same" | "changed";
/** Pure. The first run is a baseline, not a change. */
export const changed = (prev: string | null, next: string): Change => (prev === null ? "baseline" : prev === next ? "same" : "changed");

/** Pure. May this job open another case right now? Quiet hours may wrap midnight (22 -> 6). */
export function allowEscalation(s: Schedule, casesToday: number, hourUtc: number): { ok: true } | { ok: false; why: "budget" | "quiet" } {
  if (casesToday >= s.dailyCases) return { ok: false, why: "budget" };
  if (s.quiet) {
    const { fromHour: a, toHour: b } = s.quiet;
    const inQuiet = a === b ? false : a < b ? hourUtc >= a && hourUtc < b : hourUtc >= a || hourUtc < b;
    if (inQuiet) return { ok: false, why: "quiet" };
  }
  return { ok: true };
}

export type Rung = "none" | "rechecked";
export type Recheck = "confirmed" | "flaked" | null;
/** Pure. The ladder never skips the re-check: change -> recheck -> (confirmed) open a case, (flaked) stop. */
export function escalationStep(rung: Rung, recheck: Recheck): "stop" | "recheck" | "open_case" {
  if (rung === "none") return "recheck";
  return recheck === "confirmed" ? "open_case" : "stop";
}

export interface RowChange {
  rail: string;
  check: string;
  from: string;
  to: string;
}
const key = (r: ProbeRow) => `${r.rail}/${r.check}`;
/** Pure. Which (rail, check) outcomes flipped between two runs. Details (ids, messages) are ignored: only structure counts. */
export function diffRows(prev: readonly ProbeRow[], next: readonly ProbeRow[]): RowChange[] {
  const before = new Map(prev.map((r) => [key(r), r.outcome]));
  const out: RowChange[] = [];
  for (const r of next) {
    const was = before.get(key(r)) ?? "absent";
    if (was !== r.outcome) out.push({ rail: r.rail, check: r.check, from: was, to: r.outcome });
  }
  for (const [k, was] of before) if (!next.some((r) => key(r) === k)) out.push({ rail: k.split("/")[0], check: k.split("/")[1], from: was, to: "absent" });
  return out;
}
/** Pure. The structural fingerprint of a run: sorted (rail, check, outcome). Equal fingerprint = nothing changed. */
export const fingerprint = (rows: readonly ProbeRow[]): string => rows.map((r) => `${key(r)}=${r.outcome}`).sort().join(";");
