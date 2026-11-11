import { z } from "zod";
import { LEVELS } from "@/lib/computer/models";
import { DEFAULT_KIND, KINDS, KIND_INFO, MAX_HEAVY_ON, dailyCapFor, staleFor } from "./kinds";

/** Hard limits. An automation runs agents with nobody watching, so every one of these is a spending and safety bound. Each kind has tighter ones of its own (kinds.ts). */
export const MAX_AUTOMATIONS = 8;
export const MIN_EVERY_MINUTES = 30;
export const MAX_EVERY_MINUTES = 7 * 24 * 60;
export const DAILY_RUN_CAP = dailyCapFor(DEFAULT_KIND);
export const KEEP_RUNS = 10;
export const RUN_TIMEOUT_MS = KIND_INFO[DEFAULT_KIND].timeoutMs;
/** A run claimed longer ago than this is treated as dead (the server restarted mid-run) and may be started again. */
export const STALE_RUN_MS = staleFor(DEFAULT_KIND);
const DAY = 86_400_000;

export const Schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every"), minutes: z.number().int().min(MIN_EVERY_MINUTES).max(MAX_EVERY_MINUTES) }),
  /** Local wall-clock time (the viewer's offset is stored with the automation). `days` are 0 = Sunday .. 6 = Saturday. */
  z.object({ kind: z.literal("daily"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
]);
export type Schedule = z.infer<typeof Schedule>;

export const Spec = z
  .object({
    name: z.string().trim().min(1).max(60),
    prompt: z.string().trim().min(3).max(1500),
    schedule: Schedule,
    /** Minutes east of UTC at creation (what `-new Date().getTimezoneOffset()` gives in the browser). */
    tzOffsetMin: z.number().int().min(-840).max(840).default(0),
    level: z.enum(LEVELS).default("standard"),
    enabled: z.boolean().default(true),
    /** What the automation is (kinds.ts). Files written before kinds existed have none: they are Team tasks. */
    kind: z.enum(KINDS).default(DEFAULT_KIND),
    /** A Battle's teams or a Loop's rounds. Other kinds have none. */
    count: z.number().int().min(2).max(6).optional(),
  })
  .superRefine((s, ctx) => {
    const info = KIND_INFO[s.kind];
    if (s.schedule.kind === "every" && s.schedule.minutes < info.minMinutes) {
      ctx.addIssue({ code: "custom", path: ["schedule"], message: `${info.label} automations can repeat at most every ${describeSchedule({ kind: "every", minutes: info.minMinutes }).toLowerCase().replace("every ", "")}` });
    }
    if (s.count !== undefined) {
      if (!info.count) ctx.addIssue({ code: "custom", path: ["count"], message: `${info.label} automations do not take a count` });
      else if (s.count < info.count.min || s.count > info.count.max) ctx.addIssue({ code: "custom", path: ["count"], message: `${info.count.label.toLowerCase()} must be ${info.count.min} to ${info.count.max}` });
    }
  });
export type Spec = z.infer<typeof Spec>;

/** Pure. How many of these are heavy (a Battle or a Loop) and switched on, not counting `exceptId`. */
export const heavyOn = (list: readonly Pick<Automation, "id" | "kind" | "enabled">[], exceptId?: string): number => list.filter((a) => a.id !== exceptId && a.enabled && KIND_INFO[a.kind].heavy).length;
/** Pure. May a heavy automation be switched on without passing MAX_HEAVY_ON? Other kinds always may. */
export const heavyRoom = (list: readonly Pick<Automation, "id" | "kind" | "enabled">[], next: Pick<Spec, "kind" | "enabled">, exceptId?: string): boolean => !(KIND_INFO[next.kind].heavy && next.enabled) || heavyOn(list, exceptId) < MAX_HEAVY_ON;

export interface RunSummary {
  id: string;
  atMs: number;
  ms: number;
  status: "ok" | "error";
  answer: string;
  error?: string;
  /** Roles that did work, in order of first use (research, terminal ...). */
  agents: string[];
  files: { path: string; content: string }[];
  sources: { title: string; url: string }[];
  model?: string;
  /** A page stopped the browser (a CAPTCHA, a sign-in) and nobody was there to help. What it said; the task can be run again with a person watching. */
  blocked?: string;
  /** Page watch: what this run found compared with the one before. */
  watch?: "baseline" | "changed" | "unchanged";
}
export interface Automation extends Spec {
  id: string;
  createdAtMs: number;
  nextRunMs: number | null;
  lastRunMs?: number;
  /** Set when a run starts, cleared when it ends. */
  runningSince?: number;
  /** Start times of recent runs, newest last; the daily cap counts these. */
  runLog: number[];
  runs: RunSummary[];
}

/**
 * Pure. The first run time strictly after `afterMs`. `every` counts from `afterMs`; `daily` finds the next allowed weekday at the local
 * wall-clock time (using the stored UTC offset, so there is no timezone database and no clock in here).
 */
export function nextRunAfter(s: Schedule, tzOffsetMin: number, afterMs: number): number {
  if (s.kind === "every") return afterMs + s.minutes * 60_000;
  const off = tzOffsetMin * 60_000;
  const localNow = afterMs + off;
  const midnight = Math.floor(localNow / DAY) * DAY;
  for (let d = 0; d <= 7; d++) {
    const cand = midnight + d * DAY + (s.hour * 60 + s.minute) * 60_000;
    const dow = new Date(midnight + d * DAY).getUTCDay();
    if (cand > localNow && s.days.includes(dow)) return cand - off;
  }
  return afterMs + DAY; // unreachable with at least one valid day; never loops forever if the data is odd
}

const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const two = (n: number) => String(n).padStart(2, "0");
/** Pure. "Every 6 hours", "Daily at 09:00", "Weekdays at 09:00", "Mon, Thu at 18:30". */
export function describeSchedule(s: Schedule): string {
  if (s.kind === "every") {
    const m = s.minutes;
    if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
    return `Every ${m} minutes`;
  }
  const t = `${two(s.hour)}:${two(s.minute)}`;
  const days = [...new Set(s.days)].sort((a, b) => a - b);
  if (days.length === 7) return `Daily at ${t}`;
  if (days.join() === "1,2,3,4,5") return `Weekdays at ${t}`;
  if (days.join() === "0,6") return `Weekends at ${t}`;
  return `${days.map((d) => NAMES[d]).join(", ")} at ${t}`;
}

/** Pure. Runs started in the 24 hours before `now`. */
export const runsInLastDay = (a: Pick<Automation, "runLog">, now: number): number => a.runLog.filter((t) => now - t < DAY).length;

/** Pure. May this automation start a run now? Says why not, in words a person can read. */
export function canStart(a: Automation, now: number): { ok: true } | { ok: false; why: string } {
  if (a.runningSince !== undefined && now - a.runningSince < staleFor(a.kind)) return { ok: false, why: "it is already running" };
  const cap = dailyCapFor(a.kind);
  if (runsInLastDay(a, now) >= cap) return { ok: false, why: `it already ran ${cap} times in the last 24 hours` };
  return { ok: true };
}

/** Pure. Due: enabled, scheduled, past its time, and allowed to start. */
export const isDue = (a: Automation, now: number): boolean => a.enabled && a.nextRunMs !== null && a.nextRunMs <= now && canStart(a, now).ok;

/** Pure. After a run (or a missed window) the next run is counted from now: a server that was off does not replay every missed run. */
export const scheduleNext = (a: Pick<Automation, "schedule" | "tzOffsetMin">, now: number): number => nextRunAfter(a.schedule, a.tzOffsetMin, now);

export function newAutomation(spec: Spec, id: string, now: number): Automation {
  return { ...spec, id, createdAtMs: now, nextRunMs: spec.enabled ? scheduleNext(spec, now) : null, runLog: [], runs: [] };
}

/** Pure. Words that mean the person asked for something to repeat. UltraPal may only create an automation when the user's own message has one. */
export const asksForSchedule = (message: string): boolean =>
  /\b(?:(?:every|each)\s+(?:other\s+|\d+\s*)?(?:minutes?|mins?|hours?|hrs?|days?|mornings?|afternoons?|evenings?|nights?|weeks?|weekdays?|weekends?|months?|mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:nesday)?s?|thu(?:rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)|daily|weekly|hourly|monthly|nightly|mornings?|evenings?|recurring|schedule[ds]?|automat(?:e|ion|ically)|remind me|on repeat|regularly|keep (?:checking|watching|monitoring))\b/i.test(message);

/**
 * Pure. Reads the schedule text a model writes ("every 6 hours", "every 90 minutes", "daily 09:00", "weekdays 8:30", "hourly") into a
 * Schedule, or null. Anything it cannot read exactly is refused rather than guessed.
 */
export function parseSchedule(text: string): Schedule | null {
  const t = text.trim().toLowerCase();
  if (t === "hourly" || t === "every hour") return { kind: "every", minutes: 60 };
  const ev = /^every\s+(\d{1,3})\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(t);
  if (ev) {
    const n = Number(ev[1]);
    const unit = ev[2][0];
    const minutes = unit === "m" ? n : unit === "h" ? n * 60 : n * 1440;
    const r = Schedule.safeParse({ kind: "every", minutes });
    return r.success ? r.data : null;
  }
  const dl = /^(daily|weekdays|weekends|weekly)(?:\s+at)?\s+(\d{1,2}):(\d{2})$/.exec(t);
  if (dl) {
    const days = dl[1] === "daily" ? [0, 1, 2, 3, 4, 5, 6] : dl[1] === "weekdays" ? [1, 2, 3, 4, 5] : dl[1] === "weekly" ? [1] : [0, 6];
    const r = Schedule.safeParse({ kind: "daily", hour: Number(dl[2]), minute: Number(dl[3]), days });
    return r.success ? r.data : null;
  }
  return null;
}
