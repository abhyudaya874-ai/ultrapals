/**
 * Free models loop: same server restarted 13 times, two pages visited in turn. A repeated (action + page) is detected here
 * so the loop can say "that will not change" once, and stop with an honest partial result the second time.
 */
export type Repeat = "fresh" | "again" | "stuck";

/** Pure. Counts earlier occurrences of `sig` in the recent history: 0 -> fresh, 1 -> again (warn), 2+ -> stuck (stop). */
export function repeatState(history: readonly string[], sig: string, window = 10): Repeat {
  const n = history.slice(-window).filter((h) => h === sig).length;
  return n === 0 ? "fresh" : n === 1 ? "again" : "stuck";
}

export const REPEAT_NOTE = "REPEAT: you already did exactly this and the result will not change. Do something different, or finish now with what you know.";
