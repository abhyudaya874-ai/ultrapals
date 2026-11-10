import type { ProbeRow } from "@/lib/pals/probe";
import type { JobId, RowChange } from "./core";

export type RunStatus = "baseline" | "unchanged" | "flaked" | "case_opened" | "changed_unreported" | "missed";
export interface RunRecord {
  job: JobId;
  atMs: number;
  status: RunStatus;
  note: string;
}
export interface CaseRecord {
  id: string;
  job: JobId;
  openedMs: number;
  changes: RowChange[];
  /** Zero model calls were spent finding this. Opening a case hands a structural diff to a person. */
  note: string;
}
interface State {
  last: Partial<Record<JobId, { fingerprint: string; rows: ProbeRow[]; atMs: number }>>;
  lastRunMs: Partial<Record<JobId, number>>;
  runs: RunRecord[];
  cases: CaseRecord[];
  running: Set<JobId>;
}

/**
 * In-memory, per process, and it survives dev hot reloads. This is the honest limit of Proctor today: a restart forgets the baseline
 * (the next run is a new baseline, never a false alarm). A durable store needs a schema change to a protected file, so it is a separate task.
 */
const g = globalThis as unknown as { __proctor?: State };
const state = (): State => (g.__proctor ??= { last: {}, lastRunMs: {}, runs: [], cases: [], running: new Set() });

export const proctorStore = {
  get: (): State => state(),
  record(r: RunRecord): void {
    const s = state();
    s.runs = [r, ...s.runs].slice(0, 60);
    s.lastRunMs[r.job] = r.atMs;
  },
  setBaseline(job: JobId, fingerprint: string, rows: ProbeRow[], atMs: number): void {
    state().last[job] = { fingerprint, rows, atMs };
  },
  openCase(c: CaseRecord): void {
    const s = state();
    s.cases = [c, ...s.cases].slice(0, 40);
  },
  casesOnUtcDay: (job: JobId, nowMs: number): number => state().cases.filter((c) => c.job === job && new Date(c.openedMs).toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10)).length,
  reset(): void {
    g.__proctor = undefined;
  },
};
