"use client";
import { useRef, useState } from "react";
import { useDismiss } from "@/components/thread/Dock";
import { IconCheck, IconChevronRight, IconExternal, IconLink, IconMore, IconPencil, IconPin, IconSort, IconTrash } from "@/components/ui/icons";
import { GROUPS, HKINDS, HKIND_INFO, SORTS, type GroupBy, type HKind, type HistoryPrefs, type SortBy } from "./history";

const PANEL = "pop-in-down absolute z-40 rounded-xl border border-line bg-surface p-1 shadow-2xl";
const ITEM = "press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-fg-muted hover:bg-surface-2 hover:text-fg";

/** "Group by" and "Sort by" for the history, as two rows that each open a short list beside them. */
export function SortGroupMenu({ prefs, onChange }: { prefs: HistoryPrefs; onChange: (p: Partial<HistoryPrefs>) => void }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"group" | "sort" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => { setOpen(false); setSub(null); }, box);
  const groupLabel = GROUPS.find((g) => g.id === prefs.group)?.label ?? "None";
  const sortLabel = SORTS.find((s) => s.id === prefs.sort)?.label ?? "";
  const row = (id: "group" | "sort", name: string, value: string) => (
    <li key={id} className="relative" onMouseEnter={() => setSub(id)}>
      <button type="button" onClick={() => setSub(sub === id ? null : id)} aria-haspopup="menu" aria-expanded={sub === id} className={`${ITEM} justify-between ${sub === id ? "bg-surface-2 text-fg" : ""}`}>
        <span>{name}</span><span className="ml-auto text-[12.5px] text-fg-dim">{value}</span><IconChevronRight className="size-3.5" />
      </button>
      {sub === id && (
        <ul role="menu" className={`${PANEL} left-full top-0 ml-1 w-48`}>
          {(id === "group" ? GROUPS : SORTS).map((o) => {
            const on = (id === "group" ? prefs.group : prefs.sort) === o.id;
            return (
              <li key={o.id} role="none">
                <button type="button" role="menuitemradio" aria-checked={on} onClick={() => { onChange(id === "group" ? { group: o.id as GroupBy } : { sort: o.id as SortBy }); setOpen(false); setSub(null); }} className={ITEM}>
                  <span>{o.label}</span>{on && <IconCheck className="ml-auto size-4 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Sort and group" aria-expanded={open} title="Sort and group" data-testid="sort-group" className={`grid size-7 place-items-center rounded-lg ${open ? "bg-surface-2 text-fg" : "text-fg-dim hover:bg-surface-2 hover:text-fg"}`}>
        <IconSort className="size-[15px]" />
      </button>
      {open && <ul role="menu" className={`${PANEL} right-0 top-8 w-60`}>{row("group", "Group by", groupLabel)}{row("sort", "Sort by", sortLabel)}</ul>}
    </div>
  );
}

/** Which kinds of history to show. "All" clears the choice; the others add and remove themselves, so two or three kinds can be shown together. */
export function KindChips({ kinds, counts, onToggle, onClear }: { kinds: readonly HKind[]; counts: Record<HKind, number>; onToggle: (k: HKind) => void; onClear: () => void }) {
  const present = HKINDS.filter((k) => counts[k] > 0 || kinds.includes(k));
  if (present.length < 2 && kinds.length === 0) return null; // one kind is no choice
  const chip = (on: boolean) => `press h-6 shrink-0 rounded-full border px-2.5 text-[12px] ${on ? "border-fg bg-fg text-canvas" : "border-line text-fg-muted hover:bg-surface-2 hover:text-fg"}`;
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-1 px-3 pb-1 pt-1.5" data-testid="kind-chips">
      <button type="button" onClick={onClear} aria-pressed={kinds.length === 0} className={chip(kinds.length === 0)}>All</button>
      {present.map((k) => (
        <button key={k} type="button" onClick={() => onToggle(k)} aria-pressed={kinds.includes(k)} data-testid={`chip-${k}`} className={chip(kinds.includes(k))}>
          {HKIND_INFO[k].plural}<span className="ml-1 tabular-nums opacity-60">{counts[k]}</span>
        </button>
      ))}
    </div>
  );
}

/** The "…" on a row: pin it, rename it, open it in a new tab, copy its link or delete it. What a row cannot do is not offered (a promise is an audit log and cannot be deleted). */
export function RowMenu({ pinned, href, onPin, onRename, onDelete }: { pinned: boolean; href?: string; onPin: () => void; onRename?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sure, setSure] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setSure(false); };
  useDismiss(open, close, box);
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); setSure(false); }} aria-label="More" aria-expanded={open} className={`grid size-6 place-items-center rounded-md text-fg-dim hover:bg-line hover:text-fg ${open ? "bg-line text-fg" : ""}`}>
        <IconMore className="size-4" />
      </button>
      {open && (
        <ul role="menu" className={`${PANEL} right-0 top-7 w-48`}>
          <li role="none"><button type="button" role="menuitem" className={ITEM} onClick={() => { onPin(); close(); }}><IconPin className="size-4" />{pinned ? "Unpin" : "Pin"}</button></li>
          {onRename && <li role="none"><button type="button" role="menuitem" className={ITEM} onClick={() => { onRename(); close(); }}><IconPencil className="size-4" />Rename</button></li>}
          {href && <li role="none"><a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={ITEM} onClick={close}><IconExternal className="size-4" />Open in new tab</a></li>}
          {href && (
            <li role="none">
              <button type="button" role="menuitem" className={ITEM} onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${href}`); setCopied(true); setTimeout(() => { setCopied(false); close(); }, 900); } catch { close(); } }}>
                <IconLink className="size-4" />{copied ? "Copied" : "Copy link"}
              </button>
            </li>
          )}
          {onDelete && (
            <li role="none">
              <button type="button" role="menuitem" className={`${ITEM} ${sure ? "text-bad hover:text-bad" : ""}`} onClick={() => { if (!sure) setSure(true); else { onDelete(); close(); } }}>
                <IconTrash className="size-4" />{sure ? "Click again to delete" : "Delete"}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
