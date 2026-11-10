"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PREFS, parsePrefs, type Item, type RecentsPrefs } from "./recents";

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

/** Sort, group, pins and the open/closed state of the list, remembered in this browser. */
export function useRecentsPrefs(): [RecentsPrefs, (p: Partial<RecentsPrefs>) => void] {
  const [prefs, setPrefs] = useState<RecentsPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    try { setPrefs(parsePrefs(localStorage.getItem(KEY))); } catch { /* defaults */ }
  }, []);
  const update = useCallback((p: Partial<RecentsPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  return [prefs, update];
}
