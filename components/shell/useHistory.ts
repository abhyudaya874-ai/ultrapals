"use client";
import { useEffect, useMemo, useState } from "react";
import { readIndex, type ConvoEntry } from "@/components/agent/convos";
import type { PublicBrief } from "@/lib/automations/public";
import { fromAutomation, fromConvo, fromPromise, type HItem } from "./history";
import { useRecents } from "./useRecents";

/** How often the automations are looked at again while the sidebar is on screen (a scheduled run can finish at any time). */
const POLL_MS = 30_000;

/** The automations, in the light listing. Looked at again when the page changes, when something says they changed, and now and then while the tab is visible. */
function useAutomationBriefs(path: string): PublicBrief[] | null {
  const [list, setList] = useState<PublicBrief[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/automations?brief=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { automations?: PublicBrief[] } | null) => live && setList(Array.isArray(d?.automations) ? d.automations : []))
        .catch(() => live && setList((cur) => cur ?? []));
    load();
    const tick = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    window.addEventListener("automations:changed", load);
    return () => { live = false; clearInterval(tick); window.removeEventListener("automations:changed", load); };
  }, [path]);
  return list;
}

/** The conversations saved in this browser, read again whenever one is saved, renamed or deleted (here or in another tab). */
function useConvoIndex(): ConvoEntry[] {
  const [list, setList] = useState<ConvoEntry[]>([]);
  useEffect(() => {
    const load = () => { try { setList(readIndex(localStorage)); } catch { setList([]); } };
    load();
    window.addEventListener("convos:changed", load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener("convos:changed", load); window.removeEventListener("storage", load); };
  }, []);
  return list;
}

/** Chats, battles, loops, automations and promises as one list of rows. `loading` is true until the server's lists have answered once. */
export function useHistory(path: string): { items: HItem[]; loading: boolean } {
  const promises = useRecents(path, 100);
  const autos = useAutomationBriefs(path);
  const convos = useConvoIndex();
  const items = useMemo(() => [...convos.map(fromConvo), ...(autos ?? []).map(fromAutomation), ...(promises ?? []).map(fromPromise)], [convos, autos, promises]);
  return { items, loading: promises === null && autos === null };
}
