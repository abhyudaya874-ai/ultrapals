"use client";
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDismiss } from "@/components/thread/Dock";
import { IconCheck } from "./icons";

export interface MenuItem<T extends string | number> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}

/**
 * A button that opens a short list of choices, one of which is current. It opens on the frame it is pressed (CSS only), closes on Esc or an outside
 * click, and arrow keys move through the list. `up` opens it above the button (for controls at the bottom of the screen).
 */
export function Menu<T extends string | number>({ label, value, items, onChange, children, up = true, align = "left", disabled, testId, width = "w-72" }: {
  label: string;
  value: T;
  items: readonly MenuItem<T>[];
  onChange: (v: T) => void;
  /** What the button shows. */
  children: ReactNode;
  up?: boolean;
  align?: "left" | "right";
  disabled?: boolean;
  testId?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);
  const move = (e: KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const els = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(at + step + els.length) % els.length]?.focus();
  };
  return (
    <div className="relative" ref={box} onKeyDown={move}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} data-testid={testId}
        className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2/70 px-2.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-surface-2 aria-expanded:text-fg">
        {children}
      </button>
      {open && (
        <ul ref={list} id={id} role="menu" aria-label={label} className={`${up ? "pop-in bottom-full mb-2" : "pop-in-down top-full mt-2"} absolute z-40 ${align === "left" ? "left-0" : "right-0"} ${width} max-w-[calc(100vw-2rem)] rounded-2xl border border-dock-line bg-surface p-1.5 shadow-2xl`}>
          {items.map((it) => {
            const on = it.value === value;
            return (
              <li key={String(it.value)} role="none">
                <button type="button" role="menuitemradio" aria-checked={on} autoFocus={on} onClick={() => { onChange(it.value); setOpen(false); }}
                  className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                  {it.icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas/60 text-fg-muted">{it.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-fg">{it.label}</span>
                    {it.hint && <span className="block text-[12px] leading-snug text-fg-dim">{it.hint}</span>}
                  </span>
                  {on && <IconCheck className="size-4 shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
