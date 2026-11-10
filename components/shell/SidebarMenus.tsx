"use client";
import { useRef, useState } from "react";
import { useDismiss } from "@/components/thread/Dock";
import { IconCheck, IconChevronRight, IconExternal, IconLink, IconMore, IconPin, IconSort } from "@/components/ui/icons";
import { GROUPS, SORTS, type GroupBy, type RecentsPrefs, type SortBy } from "./recents";

const PANEL = "pop-in-down absolute z-40 rounded-xl border border-line bg-surface p-1 shadow-2xl";
const ITEM = "press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-fg-muted hover:bg-surface-2 hover:text-fg";

/** "Group by" and "Sort by" for the promises list, as two rows that each open a short list beside them. */
export function SortGroupMenu({ prefs, onChange }: { prefs: RecentsPrefs; onChange: (p: Partial<RecentsPrefs>) => void }) {
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
        <ul role="menu" className={`${PANEL} left-full top-0 ml-1 w-44`}>
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

/** The "…" on a promise row: pin it, open it in a new tab, or copy its link. (A promise cannot be renamed or deleted: its history is the audit log.) */
export function RowMenu({ id, pinned, onPin }: { id: string; pinned: boolean; onPin: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);
  const href = `/p?id=${id}`;
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} aria-label="More" aria-expanded={open} className={`grid size-6 place-items-center rounded-md text-fg-dim hover:bg-line hover:text-fg ${open ? "bg-line text-fg" : ""}`}>
        <IconMore className="size-4" />
      </button>
      {open && (
        <ul role="menu" className={`${PANEL} right-0 top-7 w-48`}>
          <li role="none"><button type="button" role="menuitem" className={ITEM} onClick={() => { onPin(); setOpen(false); }}><IconPin className="size-4" />{pinned ? "Unpin" : "Pin"}</button></li>
          <li role="none"><a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={ITEM} onClick={() => setOpen(false)}><IconExternal className="size-4" />Open in new tab</a></li>
          <li role="none">
            <button type="button" role="menuitem" className={ITEM} onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${href}`); setCopied(true); setTimeout(() => { setCopied(false); setOpen(false); }, 900); } catch { setOpen(false); } }}>
              <IconLink className="size-4" />{copied ? "Copied" : "Copy link"}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
