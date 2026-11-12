/**
 * A spending guard for things that bill while they are alive. A cloud computer (KERNEL) costs money for as long as it exists, and a public link lets
 * anyone start one, so a server keeps a ledger: it never has more than `concurrent` alive at once and never starts more than `perDay` in 24 hours.
 * Pure apart from the ledger it is handed. The caller keeps the ledger, so a test can hold its own.
 */
export interface Ledger {
  /** What is alive (or being started) now: key -> when it was recorded (ms). */
  alive: Map<string, number>;
  /** When each one was started in the last 24 hours (ms). */
  started: number[];
}
export interface Limits {
  concurrent: number;
  perDay: number;
}
export const DAY_MS = 86_400_000;
/** KERNEL deletes a browser ten minutes after its last use even when nobody here closed it, so a record older than this is one nobody told us about. */
export const FORGET_MS = 20 * 60_000;

export const newLedger = (): Ledger => ({ alive: new Map(), started: [] });

export type Reservation = { ok: true } | { ok: false; why: string };

/**
 * Takes a place for one more, under `key`, or says why not. A place that is taken counts for the day even if the start then fails, because a
 * failed start may still have created something that bills.
 */
export function reserve(l: Ledger, now: number, lim: Limits, key: string): Reservation {
  for (const [k, t] of l.alive) if (now - t > FORGET_MS) l.alive.delete(k);
  l.started = l.started.filter((t) => now - t < DAY_MS);
  if (l.alive.size >= lim.concurrent) return { ok: false, why: `${l.alive.size} cloud computers are already running, which is the limit for this demo (${lim.concurrent}). Try again in a minute.` };
  if (l.started.length >= lim.perDay) return { ok: false, why: `today's budget of ${lim.perDay} cloud computers is used up. It frees up as the last 24 hours roll over.` };
  l.alive.set(key, now);
  l.started.push(now);
  return { ok: true };
}

/** The place taken under `key` now belongs to the thing that was started, under its real `id` (so closing it by id gives the place back). */
export function confirm(l: Ledger, key: string, id: string): void {
  const t = l.alive.get(key);
  if (t === undefined) return;
  l.alive.delete(key);
  l.alive.set(id, t);
}

/** Gives a place back: the start failed (pass the key) or the thing was closed (pass its id). The day's count does not go back. */
export function release(l: Ledger, keyOrId: string): void {
  l.alive.delete(keyOrId);
}
