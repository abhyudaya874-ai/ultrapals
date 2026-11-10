"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { IconAgent, IconBolt, IconChevronDown, IconDollar, IconLayers, IconPanelLeft, IconPin, IconPlus, IconSearch } from "@/components/ui/icons";
import { APP_NAME, PAL_NAMES } from "@/lib/computer/pals";
import { useShell } from "./AppShell";
import { groupItems, sortItems, splitPinned, togglePin, type Item } from "./recents";
import { RowMenu, SortGroupMenu } from "./SidebarMenus";
import { useRecents, useRecentsPrefs } from "./useRecents";

interface Cap { id: string; on: boolean; note: string }
const DOT: Record<string, string> = {
  open: "bg-warn",
  capture_pending: "bg-warn animate-pulse",
  captured: "bg-ok",
  declined: "bg-bad",
  released: "bg-fg-dim",
};
// The old Dashboard, Timeline and Newsroom pages are artifacts now (open them from the panel or ask UltraPal); their URLs still work.
const NAV = [
  { href: "/automations", label: "Automations", Icon: IconBolt },
  { href: "/artifacts", label: "Artifacts", Icon: IconLayers },
  { href: "/new", label: "New promise", Icon: IconDollar },
] as const;
const ROW = "flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors";

function Row({ it, active, pinned, onPin }: { it: Item; active: boolean; pinned: boolean; onPin: () => void }) {
  return (
    <li className="group relative">
      <Link href={`/p?id=${it.id}`} data-testid="recent-row" title={it.title} className={`flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-9 transition-colors ${active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
        <span className={`size-1.5 shrink-0 rounded-full ${DOT[it.state] ?? "bg-fg-dim"}`} />
        <span className="min-w-0 flex-1 truncate">{it.title}</span>
        {pinned && <IconPin className="size-3 shrink-0 text-fg-dim" />}
      </Link>
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"><RowMenu id={it.id} pinned={pinned} onPin={onPin} /></div>
    </li>
  );
}

export function Sidebar({ onCollapse }: { onCollapse?: () => void }) {
  const path = usePathname();
  const activeId = useSearchParams().get("id");
  const items = useRecents(path, 100);
  const [prefs, setPrefs] = useRecentsPrefs();
  const [caps, setCaps] = useState<Cap[] | null>(null);
  const { open: agentOpen, toggle, newChat } = useAgent();
  const { openPalette } = useShell();
  const router = useRouter();
  const home = path === "/";

  useEffect(() => {
    let live = true;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Cap[]) => live && setCaps(Array.isArray(d) ? d : []))
      .catch(() => live && setCaps([]));
    return () => { live = false; };
  }, []);

  const view = useMemo(() => {
    const sorted = sortItems(items ?? [], prefs.sort);
    const { pinned, rest } = splitPinned(sorted, prefs.pinned);
    return { pinned, groups: groupItems(rest, prefs.group, Date.now()) };
  }, [items, prefs.sort, prefs.group, prefs.pinned]);
  const onCount = caps?.filter((c) => c.on).length ?? 0;
  const empty = items !== null && items.length === 0;

  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex h-14 items-center gap-1 px-3">
        <Link href="/" className="mr-auto px-1 font-serif text-[19px] tracking-tight text-fg">{APP_NAME}</Link>
        <button type="button" onClick={openPalette} aria-label="Search (Ctrl+K)" title="Search · Ctrl+K" data-testid="open-palette" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <IconSearch className="size-[17px]" />
        </button>
        {onCollapse && <button type="button" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar" className="hidden size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg lg:grid"><IconPanelLeft className="size-[17px]" /></button>}
      </div>

      <ul className="space-y-0.5 px-2">
        <li>
          <button type="button" data-testid="new-chat" onClick={() => { newChat(); router.push("/"); }} className={`${ROW} w-full ${home ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
            <IconPlus className="size-[17px]" />New chat
          </button>
        </li>
        {NAV.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className={`${ROW} ${path === href ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
              <Icon className="size-[17px]" />{label}
            </Link>
          </li>
        ))}
        {!home && (
          <li>
            <button type="button" data-testid="open-agent" onClick={() => toggle()} aria-pressed={agentOpen} className={`${ROW} w-full ${agentOpen ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
              <IconAgent className="size-[17px]" />{PAL_NAMES.main}<kbd className="ml-auto font-sans text-[11px] text-fg-dim">Ctrl+L</kbd>
            </button>
          </li>
        )}
      </ul>

      <div className="mt-4 flex items-center gap-1 px-3">
        <button type="button" onClick={() => setPrefs({ open: !prefs.open })} aria-expanded={prefs.open} className="group flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 text-[12.5px] font-medium text-fg-muted hover:text-fg">
          <span>Promises</span>
          <IconChevronDown className={`size-3.5 transition-transform ${prefs.open ? "" : "-rotate-90"}`} />
        </button>
        {items && items.length > 0 && <span className="text-[11.5px] tabular-nums text-fg-dim">{items.length}</span>}
        <span className="ml-auto"><SortGroupMenu prefs={prefs} onChange={setPrefs} /></span>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1 ${prefs.open ? "" : "hidden"}`} data-testid="recents">
        {items === null && <ul className="space-y-1">{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-9 animate-pulse rounded-lg bg-surface-2/40" />)}</ul>}
        {empty && <p className="px-3 py-3 text-[13px] text-fg-dim">No promises yet. <Link href="/new" className="text-accent hover:underline">Create one</Link> or ask UltraPal to.</p>}
        {view.pinned.length > 0 && (
          <section aria-label="Pinned" className="mb-2">
            <h3 className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-fg-dim">Pinned</h3>
            <ul className="space-y-0.5">{view.pinned.map((it) => <Row key={it.id} it={it} active={activeId === it.id} pinned onPin={() => setPrefs({ pinned: togglePin(prefs.pinned, it.id) })} />)}</ul>
          </section>
        )}
        {view.groups.map((g) => (
          <section key={g.label || "all"} aria-label={g.label || "Promises"} className="mb-2">
            {g.label && <h3 className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-fg-dim">{g.label}</h3>}
            <ul className="space-y-0.5">{g.items.map((it) => <Row key={it.id} it={it} active={activeId === it.id} pinned={false} onPin={() => setPrefs({ pinned: togglePin(prefs.pinned, it.id) })} />)}</ul>
          </section>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-fg-muted">
          <span className="size-1.5 rounded-full bg-accent" />PayPal sandbox
        </span>
        {caps !== null && <span className="text-[12px] text-fg-dim">{onCount}/{caps.length} on</span>}
        <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 font-sans text-[10.5px] text-fg-dim" title="Open search">Ctrl K</kbd>
      </div>
    </nav>
  );
}
