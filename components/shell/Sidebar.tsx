"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { IconAgent, IconBattle, IconBolt, IconChat, IconCheck, IconChevronDown, IconDollar, IconLayers, IconLoop, IconPanelLeft, IconPin, IconPlus, IconSearch } from "@/components/ui/icons";
import { APP_NAME, PAL_NAMES } from "@/lib/computer/pals";
import { useShell } from "./AppShell";
import { HKIND_INFO, ago, bulkPlan, countsByKind, filterItems, groupItems, pinBulk, sortItems, splitPinned, toggleKey, toggleKind, togglePin, type HItem, type HKind, type Tone } from "./history";
import { KindChips, RowMenu, SortGroupMenu } from "./SidebarMenus";
import { useHistory } from "./useHistory";
import { useHistoryPrefs } from "./useRecents";

interface Cap { id: string; on: boolean; note: string }
const ICON: Record<HKind, typeof IconChat> = { chat: IconChat, battle: IconBattle, loop: IconLoop, automation: IconBolt, promise: IconDollar };
const DOT: Record<Tone, string> = { live: "bg-accent animate-pulse", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", rest: "" };
// The old Dashboard, Timeline and Newsroom pages are artifacts now (open them from the panel or ask UltraPal); their URLs still work.
const NAV = [
  { href: "/automations", label: "Automations", Icon: IconBolt },
  { href: "/artifacts", label: "Artifacts", Icon: IconLayers },
  { href: "/new", label: "New promise", Icon: IconDollar },
] as const;
const ROW = "flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors";
const SMALL = "press h-7 rounded-md px-2 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/** A row being renamed: the title becomes a box. Enter or leaving it saves, Escape keeps the old name. */
function RenameRow({ it, onDone }: { it: HItem; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const Icon = ICON[it.kind];
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <li className="flex h-9 items-center gap-2.5 rounded-lg bg-surface-2 pl-3 pr-2">
      <Icon className="size-[15px] shrink-0 text-fg-dim" />
      <input
        ref={ref}
        defaultValue={it.title}
        maxLength={80}
        aria-label="Name"
        onKeyDown={(e) => { if (e.key === "Enter") onDone(e.currentTarget.value); else if (e.key === "Escape") { e.stopPropagation(); onDone(null); } }}
        onBlur={(e) => onDone(e.currentTarget.value)}
        className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none"
      />
    </li>
  );
}

interface RowProps {
  it: HItem;
  now: number;
  active: boolean;
  pinned: boolean;
  selecting: boolean;
  selected: boolean;
  renaming: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPin: () => void;
  onRename: () => void;
  onRenamed: (title: string | null) => void;
  onDelete: () => void;
}
function Row(p: RowProps) {
  const { it } = p;
  if (p.renaming) return <RenameRow it={it} onDone={p.onRenamed} />;
  const Icon = ICON[it.kind];
  const href = it.kind === "promise" ? `/p?id=${it.id}` : it.kind === "automation" ? `/automations?open=${it.id}` : undefined;
  const title = `${it.title}\n${it.hint} · ${ago(it.at, p.now)}`;
  const cls = `flex h-9 w-full items-center gap-2.5 rounded-lg pl-3 pr-9 text-left transition-colors ${p.active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`;
  const inner = (
    <>
      {p.selecting ? (
        <span className={`grid size-[15px] shrink-0 place-items-center rounded border ${p.selected ? "border-accent bg-accent text-canvas" : "border-fg-dim"}`}>{p.selected && <IconCheck className="size-3" />}</span>
      ) : (
        <Icon className="size-[15px] shrink-0 text-fg-dim" />
      )}
      <span className="min-w-0 flex-1 truncate">{it.title}</span>
      {DOT[it.tone] && <span className={`size-1.5 shrink-0 rounded-full ${DOT[it.tone]}`} role="img" aria-label={it.status} />}
      {p.pinned && <IconPin className="size-3 shrink-0 text-fg-dim" />}
    </>
  );
  return (
    <li className="group relative">
      {p.selecting ? (
        <button type="button" role="checkbox" aria-checked={p.selected} data-testid="recent-row" title={title} onClick={p.onToggle} className={cls}>{inner}</button>
      ) : href ? (
        <Link href={href} data-testid="recent-row" title={title} className={cls}>{inner}</Link>
      ) : (
        <button type="button" data-testid="recent-row" title={title} onClick={p.onOpen} className={cls}>{inner}</button>
      )}
      {!p.selecting && (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <RowMenu pinned={p.pinned} href={href} onPin={p.onPin} onRename={it.renamable ? p.onRename : undefined} onDelete={it.deletable ? p.onDelete : undefined} />
        </div>
      )}
    </li>
  );
}

export function Sidebar({ onCollapse }: { onCollapse?: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const promiseId = params.get("id");
  const automationId = params.get("open");
  const { items, loading } = useHistory(path);
  const [prefs, setPrefs] = useHistoryPrefs();
  const [caps, setCaps] = useState<Cap[] | null>(null);
  const { open: agentOpen, toggle, newChat, convoId, openConvo, deleteConvos, renameConvo } = useAgent();
  const { openPalette } = useShell();
  const router = useRouter();
  const home = path === "/";
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Cap[]) => live && setCaps(Array.isArray(d) ? d : []))
      .catch(() => live && setCaps([]));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 5000);
    return () => clearTimeout(t);
  }, [note]);

  const now = Date.now();
  const counts = useMemo(() => countsByKind(items), [items]);
  const view = useMemo(() => {
    const shown = filterItems(items, prefs.kinds);
    const { pinned, rest } = splitPinned(sortItems(shown, prefs.sort), prefs.pinned);
    return { shown, pinned, groups: groupItems(rest, prefs.group, Date.now()) };
  }, [items, prefs.kinds, prefs.sort, prefs.group, prefs.pinned]);
  const onCount = caps?.filter((c) => c.on).length ?? 0;
  const plan = useMemo(() => bulkPlan(items, selected), [items, selected]);

  const exitSelect = () => { setSelecting(false); setSelected([]); setConfirming(false); };
  const open = (it: HItem) => {
    if (it.kind === "promise" || it.kind === "automation") return; // those rows are links
    if (!openConvo(it.id)) { setNote("That conversation could not be opened. It may have been cleared from this browser."); return; }
    if (!home) router.push("/");
  };
  /** Deletes rows: saved conversations from this browser, automations from the server. A promise cannot be deleted (its history is the audit log). */
  const remove = async (rows: readonly HItem[]) => {
    const gone = rows.filter((r) => r.deletable);
    if (gone.length === 0) return;
    deleteConvos(gone.filter((r) => r.key.startsWith("convo:")).map((r) => r.id));
    const autos = gone.filter((r) => r.kind === "automation");
    if (autos.length) {
      const results = await Promise.all(autos.map((a) => fetch(`/api/automations?id=${a.id}`, { method: "DELETE" }).then((r) => r.ok).catch(() => false)));
      const failed = results.filter((ok) => !ok).length;
      if (failed) setNote(`Could not delete ${failed} automation${failed === 1 ? "" : "s"}.`);
      window.dispatchEvent(new Event("automations:changed"));
    }
    const keys = new Set(gone.map((g) => g.key));
    setPrefs({ pinned: prefs.pinned.filter((k) => !keys.has(k)) });
  };
  const finishRename = (it: HItem, title: string | null) => {
    setRenaming(null);
    if (title !== null && title.trim() && title.trim() !== it.title) renameConvo(it.id, title);
  };
  const isActive = (it: HItem) => (it.kind === "promise" ? path === "/p" && promiseId === it.id : it.kind === "automation" ? path === "/automations" && automationId === it.id : home && convoId === it.id);

  const row = (it: HItem, pinned: boolean) => (
    <Row
      key={it.key}
      it={it}
      now={now}
      active={!selecting && isActive(it)}
      pinned={pinned}
      selecting={selecting}
      selected={selected.includes(it.key)}
      renaming={renaming === it.key}
      onToggle={() => { setSelected((s) => toggleKey(s, it.key)); setConfirming(false); }}
      onOpen={() => open(it)}
      onPin={() => setPrefs({ pinned: togglePin(prefs.pinned, it.key) })}
      onRename={() => setRenaming(it.key)}
      onRenamed={(t) => finishRename(it, t)}
      onDelete={() => void remove([it])}
    />
  );
  const filtered = prefs.kinds.length > 0;

  return (
    <nav className="flex h-full flex-col" aria-label="Main" onKeyDown={(e) => { if (e.key === "Escape" && selecting) exitSelect(); }}>
      <div className="flex h-14 items-center gap-1 px-3">
        <Link href="/" className="mr-auto px-1 font-serif text-[19px] tracking-tight text-fg">{APP_NAME}</Link>
        <button type="button" onClick={openPalette} aria-label="Search (Ctrl+K)" title="Search · Ctrl+K" data-testid="open-palette" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <IconSearch className="size-[17px]" />
        </button>
        {onCollapse && <button type="button" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar" className="hidden size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg lg:grid"><IconPanelLeft className="size-[17px]" /></button>}
      </div>

      <ul className="space-y-0.5 px-2">
        <li>
          <button type="button" data-testid="new-chat" onClick={() => { newChat(); router.push("/"); }} className={`${ROW} w-full ${home && !convoId ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
            <IconPlus className="size-[17px]" />New chat
          </button>
        </li>
        {NAV.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className={`${ROW} ${path === href && !automationId ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/70 hover:text-fg"}`}>
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
          <span>History</span>
          <IconChevronDown className={`size-3.5 transition-transform ${prefs.open ? "" : "-rotate-90"}`} />
        </button>
        {items.length > 0 && <span className="text-[11.5px] tabular-nums text-fg-dim" data-testid="history-count">{filtered ? `${view.shown.length} of ${items.length}` : items.length}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {items.length > 0 && (
            <button type="button" onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting} aria-label="Select" title="Select" data-testid="select-mode" className={`grid size-7 place-items-center rounded-lg ${selecting ? "bg-surface-2 text-fg" : "text-fg-dim hover:bg-surface-2 hover:text-fg"}`}>
              <IconCheck className="size-[15px]" />
            </button>
          )}
          <SortGroupMenu prefs={prefs} onChange={setPrefs} />
        </span>
      </div>
      {prefs.open && <KindChips kinds={prefs.kinds} counts={counts} onToggle={(k) => setPrefs({ kinds: toggleKind(prefs.kinds, k) })} onClear={() => setPrefs({ kinds: [] })} />}

      <div className={`min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1 ${prefs.open ? "" : "hidden"}`} data-testid="recents">
        {loading && items.length === 0 && <ul className="space-y-1">{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-9 animate-pulse rounded-lg bg-surface-2/40" />)}</ul>}
        {!loading && items.length === 0 && <p className="px-3 py-3 text-[13px] text-fg-dim">Nothing here yet. Ask UltraPal something, start a Battle or a Loop, or <Link href="/automations" className="text-accent hover:underline">create an automation</Link>.</p>}
        {items.length > 0 && view.shown.length === 0 && (
          <p className="px-3 py-3 text-[13px] text-fg-dim">No {prefs.kinds.map((k) => HKIND_INFO[k].plural.toLowerCase()).join(" or ")} yet. <button type="button" onClick={() => setPrefs({ kinds: [] })} className="text-accent hover:underline">Show everything</button></p>
        )}
        {view.pinned.length > 0 && (
          <section aria-label="Pinned" className="mb-2">
            <h3 className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-fg-dim">Pinned</h3>
            <ul className="space-y-0.5">{view.pinned.map((it) => row(it, true))}</ul>
          </section>
        )}
        {view.groups.map((g) => (
          <section key={g.label || "all"} aria-label={g.label || "History"} className="mb-2">
            {g.label && <h3 className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-fg-dim">{g.label}</h3>}
            <ul className="space-y-0.5">{g.items.map((it) => row(it, false))}</ul>
          </section>
        ))}
      </div>

      {note && <p role="status" className="border-t border-line px-4 py-2 text-[12.5px] text-warn">{note}</p>}
      {selecting && prefs.open && (
        <div className="border-t border-line px-3 py-2" data-testid="select-bar">
          <div className="flex items-center gap-1 text-[12.5px] text-fg-muted">
            <span className="tabular-nums" aria-live="polite">{plan.chosen.length} selected</span>
            <button type="button" className={`${SMALL} ml-1`} onClick={() => { setSelected(view.shown.map((i) => i.key)); setConfirming(false); }}>All</button>
            <button type="button" className={SMALL} disabled={selected.length === 0} onClick={() => { setSelected([]); setConfirming(false); }}>None</button>
            <button type="button" className={`${SMALL} ml-auto`} onClick={exitSelect}>Done</button>
          </div>
          {!confirming ? (
            <div className="mt-1 flex gap-1">
              <button type="button" className={SMALL} disabled={plan.chosen.length === 0} onClick={() => setPrefs({ pinned: pinBulk(prefs.pinned, plan.chosen) })}>{plan.allPinned(prefs.pinned) ? "Unpin" : "Pin"}</button>
              <button type="button" className={`${SMALL} hover:text-bad`} disabled={plan.deletable.length === 0} title={plan.chosen.length > 0 && plan.deletable.length === 0 ? "Promises can't be deleted: their history is the audit log" : "Delete"} onClick={() => setConfirming(true)}>Delete</button>
            </div>
          ) : (
            <div className="mt-1 text-[12.5px] text-fg-muted">
              <p>Delete {plan.deletable.length}{plan.kept.length > 0 ? `, and keep ${plan.kept.length} (promises can't be deleted)` : ""}?</p>
              <div className="mt-1 flex gap-1">
                <button type="button" className={`${SMALL} text-bad`} data-testid="confirm-delete" onClick={() => { void remove(plan.deletable); exitSelect(); }}>Delete</button>
                <button type="button" className={SMALL} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

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
