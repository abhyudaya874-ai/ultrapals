import { csvOf } from "./artifacts";

/** The app's own screens UltraPal can load as data. Each becomes a CSV the planner reads and the user sees as a tab. */
export const APP_NAMES = ["newsroom", "dashboard", "timeline", "proctor"] as const;
export type AppName = (typeof APP_NAMES)[number];

export interface ArticleRow { slug: string; title: string; dek: string; premium: boolean; price: string; currency: string; published: string }
export interface VerdictLine { id: string; promiseId: string; payer: string; title: string; amount: string; state: string; kind: string; reason: string; consequence: string; at: string }
export interface AutomationLine {
  name: string;
  scheduleText: string;
  enabled: boolean;
  running: boolean;
  nextRunMs: number | null;
  lastRunMs: number | null;
  runsToday: number;
  runs: { atMs: number; ms: number; status: string; agents: string[]; error?: string; answer: string }[];
}
export interface ProctorSnap {
  schedules: { job: string; everyMs: number; lastRunMs: number | null }[];
  runs: { job: string; atMs: number; status: string; note: string }[];
  cases: { id: string; job: string; openedMs: number; note: string; changes: { rail: string; check: string; from: string; to: string }[] }[];
}

const iso = (ms: number | null): string => (ms === null ? "" : new Date(ms).toISOString());

/** Pure. Premium bodies are never included: the story text is behind the paywall and only PromisePal may unlock it. */
export const newsroomCsv = (a: readonly ArticleRow[]): string =>
  csvOf(["slug", "title", "access", "price", "currency", "published", "summary"], a.map((x) => [x.slug, x.title, x.premium ? "premium" : "free", x.price, x.currency, x.published, x.dek]));

export const verdictsCsv = (rows: readonly VerdictLine[]): string =>
  csvOf(["promise_id", "payer", "title", "amount", "state", "verdict", "reason", "consequence", "at"], rows.map((r) => [r.promiseId, r.payer, r.title, r.amount, r.state, r.kind, r.reason, r.consequence, r.at]));

/** Pure. One row per promise: its latest verdict time is the window end the Timeline draws. */
export function timelineCsv(rows: readonly VerdictLine[]): string {
  const latest = new Map<string, VerdictLine>();
  for (const r of rows) {
    const cur = latest.get(r.promiseId);
    if (!cur || r.at > cur.at) latest.set(r.promiseId, r);
  }
  return csvOf(["promise_id", "payer", "title", "amount", "state", "due_at"], [...latest.values()].sort((a, b) => a.at.localeCompare(b.at)).map((r) => [r.promiseId, r.payer, r.title, r.amount, r.state, r.at]));
}

export function proctorCsv(p: ProctorSnap): { jobs: string; events: string } {
  return {
    jobs: csvOf(["job", "every_minutes", "last_run"], p.schedules.map((s) => [s.job, Math.round(s.everyMs / 60_000), iso(s.lastRunMs)])),
    events: csvOf(["kind", "job", "at", "detail"], [
      ...p.runs.map((r) => ["run", r.job, iso(r.atMs), `${r.status}: ${r.note}`]),
      ...p.cases.map((c) => ["case", c.job, iso(c.openedMs), `${c.note}; ${c.changes.map((x) => `${x.rail}/${x.check} ${x.from}->${x.to}`).join(", ")}`]),
    ]),
  };
}

/** Pure. A line the planner sees after the artifact opened: what it is and how big. The full text is in the workspace file. */
export const openedSummary = (name: AppName, files: readonly { name: string; rows: number }[]): string =>
  `Opened the ${name} artifact. Files now in the workspace: ${files.map((f) => `${f.name} (${f.rows} rows)`).join(", ")}. Read them from the WORKSPACE FILES section or with the terminal agent.`;

/** Pure. One row per automation: schedule, state and how it is doing. */
export const automationsCsv = (list: readonly AutomationLine[]): string =>
  csvOf(["name", "schedule", "state", "next_run", "last_run", "runs_24h", "last_status"], list.map((a) => [a.name, a.scheduleText, a.running ? "running" : a.enabled ? "active" : "paused", iso(a.nextRunMs), iso(a.lastRunMs), a.runsToday, a.runs[0]?.status ?? ""]));

/** Pure. One row per finished run, newest first within each automation. */
export const automationRunsCsv = (list: readonly AutomationLine[]): string =>
  csvOf(["automation", "started", "seconds", "status", "agents", "error", "report_start"], list.flatMap((a) => a.runs.map((r) => [a.name, iso(r.atMs), Math.round(r.ms / 100) / 10, r.status, r.agents.join(" "), r.error ?? "", r.answer.replace(/\s+/g, " ").slice(0, 160)])));
