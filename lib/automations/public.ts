import { describeSchedule, runsInLastDay, DAILY_RUN_CAP, type Automation, type RunSummary } from "./core";

export type PublicRun = Omit<RunSummary, "files"> & { files: { path: string; bytes: number; content?: string }[] };
export interface PublicAutomation {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
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
    level: a.level,
    schedule: a.schedule,
    scheduleText: describeSchedule(a.schedule),
    tzOffsetMin: a.tzOffsetMin,
    nextRunMs: a.nextRunMs,
    lastRunMs: a.lastRunMs ?? null,
    running: a.runningSince !== undefined,
    runsToday: runsInLastDay(a, now),
    dailyCap: DAILY_RUN_CAP,
    runs: a.runs.map((r) => ({ ...r, files: r.files.map((f) => ({ path: f.path, bytes: f.content.length, ...(detail ? { content: f.content } : {}) })) })),
  };
}
