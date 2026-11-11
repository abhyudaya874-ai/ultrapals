"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PREFS, parsePrefs, type HistoryPrefs } from "./history";
import type { Item } from "./recents";

// The key the promises-only sidebar used: its saved sort, group and pins carry over (parsePrefs reads the old form).
const KEY = "sp-recents";

/** The promises list, reloaded when the app says a promise changed. `path` re-fetches on navigation. */
export function useRecents(path: string, limit = 60): Item[] | null {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/promises/recent?limit=${limit}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: Item[]) => live && setItems(Array.isArray(d) ? d : []))
        .catch(() => live && setItems([]));
    load();
    window.addEventListener("promises:changed", load);
    return () => { live = false; window.removeEventListener("promises:changed", load); };
  }, [path, limit]);
  return items;
}

/** Sort, group, the kinds shown, pins and the open/closed state of the history, remembered in this browser. */
export function useHistoryPrefs(): [HistoryPrefs, (p: Partial<HistoryPrefs>) => void] {
  const [prefs, setPrefs] = useState<HistoryPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    try { setPrefs(parsePrefs(localStorage.getItem(KEY))); } catch { /* defaults */ }
  }, []);
  const update = useCallback((p: Partial<HistoryPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  return [prefs, update];
}
