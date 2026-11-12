import { allow } from "@/lib/research/rate-limit";

export const DAY_MS = 86_400_000;
export type Kind = "run" | "contest";
export type Gate = { ok: true } | { ok: false; error: string; retryAfterSec: number };

/** One person's share of a day's cap: a quarter, so no single address can use the whole day up for everyone else. */
export const personalShare = (cap: number): number => Math.max(1, Math.ceil(cap / 4));

const WHAT: Record<Kind, string> = { run: "messages", contest: "Battles and Loops" };

/**
 * Pure apart from the shared rate-limit memory. Whether one more message (or Battle or Loop) may start: first the person's own share of the day, then
 * the whole server's cap. The person's share is checked first so that someone turned away cannot also use up what is left for everyone else.
 * The free model and search quotas behind this are small, and anything that bills (cloud computers) is capped separately in lib/budget/ledger.ts.
 */
export function dailyGate(who: string, kind: Kind, caps: { run: number; contest: number }, now: number = Date.now()): Gate {
  const cap = kind === "run" ? caps.run : caps.contest;
  const mine = personalShare(cap);
  if (!allow(`day-${kind}:${who}`, now, mine, DAY_MS)) {
    return { ok: false, retryAfterSec: 3600, error: `You have used your share of today's demo (${mine} ${WHAT[kind]}). It frees up as the last 24 hours roll over.` };
  }
  if (!allow(`day-${kind}:everyone`, now, cap, DAY_MS)) {
    return { ok: false, retryAfterSec: 3600, error: `Today's demo budget (${cap} ${WHAT[kind]}) is used up for everyone. The demo runs on free tiers, so it frees up as the last 24 hours roll over.` };
  }
  return { ok: true };
}
