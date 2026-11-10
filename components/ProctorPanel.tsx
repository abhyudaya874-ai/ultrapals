"use client";
import { useCallback, useEffect, useState } from "react";

interface Status {
  schedules: { job: string; everyMs: number; lastRunMs: number | null; due: boolean }[];
  runs: { job: string; atMs: number; status: string; note: string }[];
  cases: { id: string; job: string; openedMs: number; changes: { rail: string; check: string; from: string; to: string }[]; note: string }[];
  durable: boolean;
}
const CHIP: Record<string, string> = { baseline: "bg-surface-2 text-fg-muted", unchanged: "bg-ok/15 text-ok", flaked: "bg-warn/15 text-warn", case_opened: "bg-bad/15 text-bad", changed_unreported: "bg-bad/15 text-bad", missed: "bg-warn/15 text-warn" };
const WORD: Record<string, string> = { baseline: "Baseline", unchanged: "Unchanged", flaked: "Flaked", case_opened: "Case opened", changed_unreported: "Changed", missed: "Missed" };
const ago = (ms: number | null): string => (ms === null ? "never" : `${Math.max(0, Math.round((Date.now() - ms) / 60_000))} min ago`);

/** Proctor: the timetable, what each check last found, and the cases it opened. Zero model calls. */
export function ProctorPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/proctor", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setS((await r.json()) as Status);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async () => {
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/proctor?force=1", { method: "POST" }).catch(() => null);
    setMsg(r?.ok ? "" : r?.status === 401 ? "PROCTOR_TOKEN is set: run it from the timer with the x-proctor-token header." : "Could not run the checks.");
    await load();
    setBusy(false);
  };
  return (
    <section className="mb-3 space-y-2 rounded-card bg-surface p-3.5" data-testid="proctor" aria-label="Proctor">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-medium text-fg">Proctor</h2>
        <span className="text-[12.5px] text-fg-dim">checks on a timetable, 0 model calls; opens a case only when a change is confirmed</span>
        <button type="button" onClick={() => void run()} disabled={busy} className="ml-auto h-8 rounded-full border border-line bg-surface-2 px-3 text-[12.5px] text-fg hover:bg-black/30 disabled:opacity-50" data-testid="proctor-run">{busy ? "Running…" : "Run the checks now"}</button>
      </div>
      {msg && <p role="alert" className="text-[12.5px] text-warn">{msg}</p>}
      <ul className="divide-y divide-line text-[13px]" data-testid="proctor-jobs">
        {(s?.schedules ?? []).map((x) => {
          const last = s?.runs.find((r) => r.job === x.job);
          return (
            <li key={x.job} className="flex flex-wrap items-baseline gap-2 py-1.5">
              <span className="w-32 shrink-0 text-fg">{x.job.replace(/_/g, " ")}</span>
              <span className="text-fg-dim">every {Math.round(x.everyMs / 3_600_000)}h · last {ago(x.lastRunMs)}</span>
              {last && <span className={`rounded-full px-2 py-0.5 text-[12px] ${CHIP[last.status] ?? CHIP.baseline}`}>{WORD[last.status] ?? last.status}</span>}
              {last && <span className="min-w-0 truncate text-fg-dim">{last.note}</span>}
            </li>
          );
        })}
      </ul>
      {(s?.cases ?? []).map((c) => (
        <div key={c.id} className="rounded-lg bg-black/25 p-2.5 text-[12.5px]" data-testid="proctor-case">
          <p className="text-fg">Case · {c.job.replace(/_/g, " ")} · {ago(c.openedMs)}</p>
          <ul className="text-fg-muted">{c.changes.map((ch) => <li key={`${ch.rail}${ch.check}`}>{ch.rail} · {ch.check.replace(/_/g, " ")}: {ch.from} → {ch.to}</li>)}</ul>
        </div>
      ))}
      <p className="text-[12px] text-fg-dim">Memory is per server process: a restart starts a new baseline, never a false alarm. A durable store needs a schema change and is a separate task.</p>
    </section>
  );
}
