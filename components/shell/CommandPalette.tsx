"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { APP_ARTIFACTS } from "@/components/agent/panel-model";
import { IconBolt, IconBoard, IconClock, IconDollar, IconFile, IconGlobe, IconLayers, IconPlus, IconReturn, IconSearch } from "@/components/ui/icons";
import type { PublicAutomation } from "@/lib/automations/public";
import { matchRanges, rank } from "./palette";
import { stateLabel } from "./recents";
import { useRecents } from "./useRecents";

interface Entry {
  id: string;
  group: "Actions" | "Artifacts" | "Promises" | "Automations" | "Files";
  label: string;
  hint?: string;
  keywords?: string;
  Icon: typeof IconSearch;
  run: () => void;
}
const ORDER: Entry["group"][] = ["Actions", "Artifacts", "Promises", "Automations", "Files"];

function Marked({ text, query }: { text: string; query: string }) {
  const rs = matchRanges(query, text);
  if (rs.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  rs.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i} className="rounded-sm bg-accent/25 text-fg">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** Ctrl/Cmd+K: jump to a page, open an artifact, find a promise, an automation or a file, or start a chat. One list, typed to filter. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { newChat, openApp, stored, openLocalFile, send } = useAgent();
  const promises = useRecents("palette", 100);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [autos, setAutos] = useState<PublicAutomation[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    requestAnimationFrame(() => input.current?.focus());
    let live = true;
    fetch("/api/automations", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: { automations?: PublicAutomation[] } | null) => live && setAutos(d?.automations ?? [])).catch(() => undefined);
    return () => { live = false; };
  }, [open]);

  const go = useCallback((fn: () => void) => () => { onClose(); fn(); }, [onClose]);
  const entries = useMemo<Entry[]>(() => [
    { id: "a-new", group: "Actions", label: "New chat", hint: "Start fresh with UltraPal", keywords: "ask conversation", Icon: IconPlus, run: go(() => { newChat(); router.push("/"); }) },
    { id: "a-promise", group: "Actions", label: "New promise", hint: "Create a Standing Promise", keywords: "pay money form", Icon: IconDollar, run: go(() => router.push("/new")) },
    { id: "a-auto", group: "Actions", label: "Automations", hint: "Scheduled agent runs", keywords: "schedule cron recurring", Icon: IconBolt, run: go(() => router.push("/automations")) },
    { id: "a-art", group: "Actions", label: "Artifacts", hint: "Files and app screens", keywords: "gallery files csv", Icon: IconLayers, run: go(() => router.push("/artifacts")) },
    ...(Object.keys(APP_ARTIFACTS) as (keyof typeof APP_ARTIFACTS)[]).map((n): Entry => ({ id: `app-${n}`, group: "Artifacts", label: `Open ${APP_ARTIFACTS[n].title}`, hint: APP_ARTIFACTS[n].blurb, keywords: n, Icon: n === "newsroom" ? IconGlobe : n === "timeline" ? IconClock : n === "dashboard" ? IconBoard : IconBolt, run: go(() => { openApp(n); router.push("/"); }) })),
    ...(promises ?? []).map((p): Entry => ({ id: `p-${p.id}`, group: "Promises", label: p.title, hint: stateLabel(p.state), keywords: p.state, Icon: IconDollar, run: go(() => router.push(`/p?id=${p.id}`)) })),
    ...autos.map((a): Entry => ({ id: `au-${a.id}`, group: "Automations", label: a.name, hint: a.scheduleText, keywords: a.prompt, Icon: IconBolt, run: go(() => router.push("/automations")) })),
    ...stored.slice(0, 40).map((f): Entry => ({ id: `f-${f.source}-${f.from ?? ""}-${f.path}`, group: "Files", label: f.path.replace(/^\/workspace\/(artifacts\/)?/, ""), hint: f.source === "automation" ? `Automation: ${f.from ?? ""}` : "Chat", Icon: IconFile, run: go(() => { openLocalFile(f.path, f.content); router.push("/"); }) })),
  ], [promises, autos, stored, router, newChat, openApp, openLocalFile, go]);

  const results = useMemo(() => rank(q, entries, 40), [q, entries]);
  const asChat = q.trim().length >= 2 ? { id: "ask", label: `Ask UltraPal: ${q.trim()}`, run: go(() => { router.push("/"); void send(q.trim()); }) } : null;
  const total = results.length + (asChat ? 1 : 0);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (!open) return null;

  const grouped = ORDER.map((g) => ({ g, items: results.filter((r) => r.group === g) })).filter((x) => x.items.length);
  let idx = -1;
  return (
    <div className="fade-in fixed inset-0 z-[80] grid place-items-start justify-items-center bg-black/55 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="palette">
      <div role="dialog" aria-label="Command palette" className="sheet-in w-full max-w-[600px] overflow-hidden rounded-2xl border border-dock-line bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <IconSearch className="size-[18px] shrink-0 text-fg-dim" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search promises, automations, files, or jump to a page…"
            aria-label="Search"
            aria-controls="palette-list"
            role="combobox"
            aria-expanded="true"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (total ? (s + 1) % total : 0)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (total ? (s - 1 + total) % total : 0)); }
              else if (e.key === "Enter") { e.preventDefault(); (sel < results.length ? results[sel] : asChat)?.run(); }
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-dim"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-sans text-[11px] text-fg-dim">Esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {grouped.map(({ g, items }) => (
            <li key={g} role="presentation">
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-fg-dim">{g}</p>
              <ul role="presentation">
                {items.map((e) => {
                  idx++;
                  const my = idx;
                  return (
                    <li key={e.id} role="option" aria-selected={sel === my} data-idx={my}>
                      <button type="button" onMouseMove={() => setSel(my)} onClick={e.run} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${sel === my ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
                        <e.Icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[14px]"><Marked text={e.label} query={q} /></span>
                        {e.hint && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-fg-dim">{e.hint}</span>}
                        {sel === my && <IconReturn className="size-3.5 shrink-0 text-fg-dim" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {results.length === 0 && !asChat && <li className="px-3 py-8 text-center text-[13px] text-fg-dim">Nothing matches “{q}”.</li>}
          {asChat && (() => {
            const my = results.length;
            return (
              <li role="option" aria-selected={sel === my} data-idx={my} className={results.length ? "mt-1 border-t border-line pt-1" : ""}>
                <button type="button" onMouseMove={() => setSel(my)} onClick={asChat.run} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${sel === my ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
                  <IconSearch className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[14px]">{asChat.label}</span>{sel === my && <IconReturn className="size-3.5 shrink-0 text-fg-dim" />}
                </button>
              </li>
            );
          })()}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-fg-dim">
          <span><kbd className="font-sans">↑↓</kbd> to move</span><span><kbd className="font-sans">Enter</kbd> to open</span><span className="ml-auto">{results.length} result{results.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
