import type { AgentProfile } from "./types";

export const CYCLE_BUDGET_MS = 30000; // guard 2.5 + observer 5 + resolver 20 + reconciler 1 + slack

/** Wall-clock budget for one cycle. Correct for serial AND parallel agents. */
export class Budget {
  private readonly startedAt = Date.now();

  get elapsed(): number {
    return Date.now() - this.startedAt;
  }
  get remaining(): number {
    return Math.max(0, CYCLE_BUDGET_MS - this.elapsed);
  }
  get exhausted(): boolean {
    return this.remaining === 0;
  }
  /** Profile cap, clipped by what is left of the cycle. */
  timeoutFor(p: AgentProfile): number {
    return Math.min(p.maxMs, this.remaining);
  }
}

/**
 * Runs `run(signal)` with a hard deadline. The deadline REJECTS even if `run`
 * ignores the signal, so a misbehaving agent can never hang the cycle.
 */
export async function withTimeout<T>(
  p: AgentProfile,
  budget: Budget,
  parent: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ms = budget.timeoutFor(p);
  if (ms <= 0) throw new Error("cycle budget exhausted");

  const ac = new AbortController();
  const onParent = () => ac.abort(parent.reason);
  parent.addEventListener("abort", onParent, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${p.id} timed out after ${ms}ms`);
      ac.abort(err);
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([run(ac.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParent);
  }
}
