import { getEnv } from "@/lib/env";
import { confirm, newLedger, release, reserve, type Ledger, type Reservation } from "./ledger";

// Kept on globalThis, like the session store: Next bundles each route separately (and re-creates modules in development), and every route that can
// start a cloud computer must count against the same ledger.
const g = globalThis as unknown as { __spKernelLedger?: Ledger };
const ledger = (): Ledger => (g.__spKernelLedger ??= newLedger());

/** Asks for a place for one more cloud computer, under `key`. Refused when the server already has too many alive or has started too many today. */
export function takeCloudComputer(key: string, now: number = Date.now()): Reservation {
  const e = getEnv();
  return reserve(ledger(), now, { concurrent: e.KERNEL_MAX_BROWSERS, perDay: e.KERNEL_MAX_PER_DAY }, key);
}
/** The start worked: the place held under `key` now belongs to the computer with this id. */
export const startedCloudComputer = (key: string, id: string): void => confirm(ledger(), key, id);
/** The start failed (pass the key) or the computer was deleted (pass its id). */
export const releaseCloudComputer = (keyOrId: string): void => release(ledger(), keyOrId);
/** For tests. */
export function resetCloudComputers(): void {
  g.__spKernelLedger = newLedger();
}
