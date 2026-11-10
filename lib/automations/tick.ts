import { isDue, type RunSummary } from "./core";
import { runAutomation, type RunDeps } from "./run";
import type { createStore } from "./store";

export interface TickDeps extends RunDeps {
  store: ReturnType<typeof createStore>;
}
export type Started = { ok: true; id: string } | { ok: false; why: string };

const g = globalThis as unknown as { __automationBusy?: string };
/** One automation runs at a time per process: each can open a cloud computer and spend model quota, so they queue instead of piling up. */
export const runningNow = (): string | null => g.__automationBusy ?? null;

/**
 * Claims the automation, runs it, stores the result. Resolves when the run is over. A run that crashes is stored as a failed run, and the
 * claim is always released, so one bad run can never leave an automation stuck as "running".
 */
export async function execute(id: string, t: TickDeps, signal?: AbortSignal): Promise<{ ok: true; run: RunSummary } | { ok: false; why: string }> {
  if (g.__automationBusy) return { ok: false, why: "another automation is running; try again in a minute" };
  g.__automationBusy = id;
  try {
    const claim = await t.store.claim(id, t.now());
    if (!claim.ok) return claim;
    let run: RunSummary;
    try {
      run = await runAutomation(claim.automation, t, signal);
    } catch (e) {
      run = { id: t.id(), atMs: t.now(), ms: 0, status: "error", answer: "", error: e instanceof Error ? e.message.slice(0, 300) : "the run crashed", agents: [], files: [], sources: [] };
    }
    await t.store.finish(id, run, t.now());
    return { ok: true, run };
  } finally {
    g.__automationBusy = undefined;
  }
}

/** Starts a run in the background and returns at once (the Automations page polls for the result). */
export async function startNow(id: string, t: TickDeps): Promise<Started> {
  if (g.__automationBusy) return { ok: false, why: "another automation is running; try again in a minute" };
  const a = await t.store.get(id);
  if (!a) return { ok: false, why: "no such automation" };
  void execute(id, t).catch(() => undefined);
  return { ok: true, id };
}

/** Runs the one most overdue automation, if any is due. Called by the in-process timer and by POST /api/automations/tick. */
export async function tickDue(t: TickDeps, signal?: AbortSignal): Promise<{ ran: string | null; why?: string }> {
  if (g.__automationBusy) return { ran: null, why: "busy" };
  const now = t.now();
  const due = (await t.store.list()).filter((a) => isDue(a, now)).sort((a, b) => (a.nextRunMs ?? 0) - (b.nextRunMs ?? 0));
  if (due.length === 0) return { ran: null };
  const r = await execute(due[0].id, t, signal);
  return r.ok ? { ran: due[0].id } : { ran: null, why: r.why };
}
