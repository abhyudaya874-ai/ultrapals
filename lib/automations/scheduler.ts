import { defaultDeps } from "@/lib/computer/ctx";
import { endSession, getSession } from "@/lib/computer/session";
import { closeBrowser } from "@/lib/integrations/kbrowser";
import { automationStore } from "./store";
import { tickDue, type TickDeps } from "./tick";

export const TICK_MS = 30_000;

/** The runner's real dependencies: the live agent team, a fresh conversation per run, and the file store. */
export const liveTickDeps = (): TickDeps => ({
  deps: defaultDeps,
  now: Date.now,
  id: () => crypto.randomUUID(),
  open: () => getSession(undefined, closeBrowser),
  close: async (s) => { await endSession(s.id, closeBrowser); },
  store: automationStore(),
});

const g = globalThis as unknown as { __automationTimer?: ReturnType<typeof setInterval> };

/** Starts the in-process timer once (a dev hot reload does not start a second). It only looks at the file; it spends nothing unless something is due. */
export function startScheduler(): void {
  if (g.__automationTimer) return;
  g.__automationTimer = setInterval(() => { void tickDue(liveTickDeps()).catch(() => undefined); }, TICK_MS);
  g.__automationTimer.unref?.();
}
