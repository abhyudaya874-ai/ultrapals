import { describeSchedule, runsInLastDay, type Automation, type RunSummary } from "./core";
import { dailyCapFor, kindOf, type Kind } from "./kinds";

export type PublicRun = Omit<RunSummary, "files"> & { files: { path: string; bytes: number; content?: string }[] };
export interface PublicAutomation {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  kind: Kind;
  /** A Battle's teams or a Loop's rounds. */
  count: number | null;
  level: Automation["level"];
  schedule: Automation["schedule"];
  scheduleText: string;
  tzOffsetMin: number;
  nextRunMs: number | null;
  lastRunMs: number | null;
  running: boolean;
  runsToday: number;
  dailyCap: number;
  runs: PublicRun[];
}

/** Pure. What the browser gets. The list view leaves out file contents (they can be large); `detail` includes them for the one automation being opened. */
export function toPublic(a: Automation, now: number, detail: boolean): PublicAutomation {
  return {
    id: a.id,
    name: a.name,
    prompt: a.prompt,
    enabled: a.enabled,
    kind: kindOf(a.kind),
    count: a.count ?? null,
    level: a.level,
    schedule: a.schedule,
    scheduleText: describeSchedule(a.schedule),
    tzOffsetMin: a.tzOffsetMin,
    nextRunMs: a.nextRunMs,
    lastRunMs: a.lastRunMs ?? null,
    running: a.runningSince !== undefined,
    runsToday: runsInLastDay(a, now),
    dailyCap: dailyCapFor(kindOf(a.kind)),
    runs: a.runs.map((r) => ({ ...r, files: r.files.map((f) => ({ path: f.path, bytes: f.content.length, ...(detail ? { content: f.content } : {}) })) })),
  };
}

/** What the sidebar needs about an automation: no prompts, no run output, so it can be fetched often. */
export interface PublicBrief {
  id: string;
  name: string;
  kind: Kind;
  count: number | null;
  enabled: boolean;
  running: boolean;
  scheduleText: string;
  createdAtMs: number;
  lastRunMs: number | null;
  /** How the latest run ended; null before the first run. */
  last: "ok" | "error" | null;
  /** The latest run met a wall nobody could pass. */
  blocked: boolean;
}

/** Pure. The light listing entry. */
export function toBrief(a: Automation): PublicBrief {
  const last = a.runs[0];
  return { id: a.id, name: a.name, kind: kindOf(a.kind), count: a.count ?? null, enabled: a.enabled, running: a.runningSince !== undefined, scheduleText: describeSchedule(a.schedule), createdAtMs: a.createdAtMs, lastRunMs: a.lastRunMs ?? null, last: last ? last.status : null, blocked: !!last?.blocked };
}
