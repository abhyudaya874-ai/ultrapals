import type { ProbeRow } from "@/lib/pals/probe";
import type { AdapterResult } from "@/lib/integrations/types";
import { DEFAULT_SCHEDULES, allowEscalation, changed, diffRows, dueJobs, escalationStep, fingerprint, type JobId, type Schedule } from "./core";
import { proctorStore, type RunRecord } from "./store";

export interface ProctorDeps {
  probes: {
    stripe: (runId: string) => Promise<AdapterResult<ProbeRow[]>>;
    square: (runId: string) => Promise<AdapterResult<ProbeRow[]>>;
    paypal: () => Promise<AdapterResult<ProbeRow[]>>;
  };
  now: () => number;
  id: () => string;
}

/** One pass of the canary: every rail's sandbox checks, or null if any adapter could not run (a missed run is NEVER "no change"). */
async function canary(d: ProctorDeps): Promise<ProbeRow[] | null> {
  const runId = d.id();
  const got = await Promise.all([d.probes.stripe(runId), d.probes.square(runId), d.probes.paypal()]);
  // A rail that is switched off (no key) is simply absent; a rail that errored is a missed run.
  const rows: ProbeRow[] = [];
  for (const r of got) {
    if (r.ok) rows.push(...r.data);
    else if (!/ off$|only sk_test_/.test(r.reason)) return null;
  }
  return rows.length ? rows : null;
}

/**
 * Runs every due job once. Diff-first: an unchanged fingerprint stops with zero further work. A change is re-checked at once; only a
 * CONFIRMED change opens a case, and only if the daily case budget and quiet hours allow. No model is called anywhere in here.
 */
export async function runDue(d: ProctorDeps, schedules: readonly Schedule[] = DEFAULT_SCHEDULES): Promise<RunRecord[]> {
  const s = proctorStore.get();
  const out: RunRecord[] = [];
  for (const job of dueJobs(schedules, s.lastRunMs, d.now())) {
    if (s.running.has(job)) continue; // a double fire runs one logical job
    s.running.add(job);
    try {
      const sched = schedules.find((x) => x.job === job)!;
      const at = d.now();
      const rows = await runJob(job, d);
      let rec: RunRecord;
      if (!rows) rec = { job, atMs: at, status: "missed", note: "the check could not run; this is not 'no change'" };
      else {
        const fp = fingerprint(rows);
        const prev = s.last[job] ?? null;
        const c = changed(prev?.fingerprint ?? null, fp);
        if (c === "baseline") {
          proctorStore.setBaseline(job, fp, rows, at);
          rec = { job, atMs: at, status: "baseline", note: `${rows.length} checks recorded` };
        } else if (c === "same") {
          proctorStore.setBaseline(job, fp, rows, at);
          rec = { job, atMs: at, status: "unchanged", note: "identical to the last run; 0 further work" };
        } else {
          const step1 = escalationStep("none", null); // always "recheck"
          const again = step1 === "recheck" ? await runJob(job, d) : null;
          const recheck = again ? (fingerprint(again) === fp ? "confirmed" : fingerprint(again) === prev!.fingerprint ? "flaked" : "confirmed") : null;
          const step2 = escalationStep("rechecked", recheck);
          if (step2 === "open_case") {
            const gate = allowEscalation(sched, proctorStore.casesOnUtcDay(job, at), new Date(at).getUTCHours());
            const changes = diffRows(prev!.rows, again ?? rows);
            if (gate.ok) {
              proctorStore.openCase({ id: d.id(), job, openedMs: at, changes, note: "confirmed on a second run" });
              proctorStore.setBaseline(job, fp, rows, at);
              rec = { job, atMs: at, status: "case_opened", note: `${changes.length} check${changes.length === 1 ? "" : "s"} changed and stayed changed` };
            } else {
              rec = { job, atMs: at, status: "changed_unreported", note: `changed, but no case opened (${gate.why}); the baseline is kept so it is reported later` };
            }
          } else {
            rec = { job, atMs: at, status: "flaked", note: "changed once, then went back on the re-check" };
          }
        }
      }
      proctorStore.record(rec);
      out.push(rec);
    } finally {
      s.running.delete(job);
    }
  }
  return out;
}

const runJob = (job: JobId, d: ProctorDeps): Promise<ProbeRow[] | null> => (job === "sandbox_canary" ? canary(d) : Promise.resolve(null));
