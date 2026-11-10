"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PromiseState } from "@/db/schema";
import { useAgent } from "@/components/agent/AgentProvider";
import { APP_NAME, PAL_NAMES } from "@/lib/computer/pals";
import { IconAgent, IconBoard, IconClock, IconGlobe, IconPlus, IconSearch } from "@/components/ui/icons";

interface Item { id: string; title: string; state: PromiseState; createdAt: string }
interface Cap { id: string; on: boolean; note: string }

const DOT: Record<PromiseState, string> = {
  open: "bg-warn",
  capture_pending: "bg-warn animate-pulse",
  captured: "bg-ok",
  declined: "bg-bad",
  released: "bg-fg-dim",
};
const NAV = [
  { href: "/", label: "New promise", Icon: IconPlus },
  { href: "/board", label: "Dashboard", Icon: IconBoard },
  { href: "/timeline", label: "Timeline", Icon: IconClock },
  { href: "/newsroom", label: "Newsroom", Icon: IconGlobe },
] as const;

export function Sidebar() {
  const path = usePathname();
  const activeId = useSearchParams().get("id");
  const [items, setItems] = useState<Item[] | null>(null);
  const [caps, setCaps] = useState<Cap[] | null>(null);
  const [q, setQ] = useState("");
  const [find, setFind] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/promises/recent?limit=40")
        .then((r) => (r.ok ? r.json() : []))
        .then((d: Item[]) => live && setItems(Array.isArray(d) ? d : []))
        .catch(() => live && setItems([]));
    load();
    window.addEventListener("promises:changed", load);
    return () => { live = false; window.removeEventListener("promises:changed", load); };
  }, [path]);

  useEffect(() => {
    let live = true;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Cap[]) => live && setCaps(Array.isArray(d) ? d : []))
      .catch(() => live && setCaps([]));
    return () => { live = false; };
  }, []);

  const shown = useMemo(() => (items ?? []).filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const row = "flex h-10 items-center gap-3 rounded-lg px-3 text-[14px]";
  const { open: agentOpen, toggle } = useAgent();
  const onCount = caps?.filter((c) => c.on).length ?? 0;

  return (
    <nav className="flex h-full flex-col" aria-label="Promises">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="font-serif text-[18px] text-fg">{APP_NAME}</Link>
        <button type="button" aria-label="Search promises" aria-pressed={find} onClick={() => setFind((f) => !f)} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg">
          <IconSearch className="size-[18px]" />
        </button>
      </div>
      {find && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter promises" className="mx-3 mb-2 h-9 rounded-lg border border-line bg-canvas px-3 text-[14px] outline-none placeholder:text-fg-dim" />}
      <ul className="px-2">
        {NAV.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className={`${row} ${path === href ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
              <Icon className="size-[18px]" />{label}
            </Link>
          </li>
        ))}
        <li>
          <button type="button" data-testid="open-agent" onClick={() => toggle()} aria-pressed={agentOpen} className={`${row} w-full ${agentOpen ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
            <IconAgent className="size-[18px]" />{PAL_NAMES.main}<kbd className="ml-auto font-sans text-[11px] text-fg-dim">Ctrl+L</kbd>
          </button>
        </li>
      </ul>
      <h2 className="px-5 pb-1 pt-5 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Promises</h2>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2" data-testid="recents">
        {items === null && Array.from({ length: 6 }, (_, i) => <li key={i} className="h-9 animate-pulse rounded-lg bg-surface-2/40" />)}
        {shown.map((it) => (
          <li key={it.id}>
            <Link href={`/p?id=${it.id}`} data-testid="recent-row" className={`flex h-9 items-center gap-2 rounded-lg px-3 ${activeId === it.id ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
              <span className={`size-1.5 shrink-0 rounded-full ${DOT[it.state]}`} />
              <span className="min-w-0 flex-1 truncate">{it.title}</span>
            </Link>
          </li>
        ))}
        {items && shown.length === 0 && <li className="px-3 py-2 text-fg-dim">{q ? "No match." : "No promises yet."}</li>}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-fg-muted">
          <span className="size-1.5 rounded-full bg-accent" />PayPal sandbox
        </span>
        {caps !== null && <p className="mt-2 text-[12px] text-fg-dim">{onCount} of {caps.length} vendors on</p>}
      </div>
    </nav>
  );
}
