"use client";
import { useEffect, useRef, useState } from "react";

/** How long a closing thing stays mounted: a little longer than the 160ms transition (`--t`) plus the frame it needs to start. */
export const EXIT_MS = 200;

/**
 * True while `open` is true and for `ms` after it turns false, so something that is closing has time to play its exit before it is removed.
 * Opening is immediate: the very render that has `open` already returns true. Opening again during the exit simply keeps it.
 */
export function usePresent(open: boolean, ms: number = EXIT_MS): boolean {
  const [held, setHeld] = useState(open);
  useEffect(() => {
    if (open) { setHeld(true); return; }
    const t = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return open || held;
}

/**
 * The last value that was not null, kept while `value` is null for `ms`. An overlay whose content comes from state that is cleared on close
 * (a pending plan) uses this to keep drawing the old content while it fades out.
 */
export function useLast<T>(value: T | null, ms: number = EXIT_MS): T | null {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setKept(value); return; }
    const t = setTimeout(() => setKept(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value ?? kept;
}

/**
 * The keys that appeared after the list first had content (`ready`). The first batch is the baseline and does not count as new. A key stays
 * in the set once added, so a later render cannot cut its entrance animation short by dropping the class.
 */
export function useFresh(keys: readonly string[], ready: boolean): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const fresh = useRef<Set<string>>(new Set());
  if (ready) {
    if (seen.current === null) seen.current = new Set(keys);
    else for (const k of keys) if (!seen.current.has(k)) { seen.current.add(k); fresh.current.add(k); }
  }
  return fresh.current;
}
