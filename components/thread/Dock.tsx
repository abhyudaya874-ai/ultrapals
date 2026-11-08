"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { IconArrowUp } from "@/components/ui/icons";

export function Dock(p: {
  statusLine: string; manual?: React.ReactNode; menu?: React.ReactNode;
  running: boolean; disabled: boolean; label: string; onSettle: () => void;
}) {
  return (
    <div data-testid="dock" className="rounded-dock border border-dock-line bg-dock p-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      <div className="min-h-14 px-2 py-1.5 text-[15px] text-fg-muted">{p.manual ?? p.statusLine}</div>
      <div className="flex items-center gap-1">
        {p.menu}
        <button type="button" onClick={p.onSettle} disabled={p.disabled || p.running} aria-label={p.label}
          className="ml-auto grid size-10 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">
          {p.running
            ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <IconArrowUp className="size-5" />}
        </button>
      </div>
    </div>
  );
}

/** Esc and outside click close a popover or pane. */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void, ref: RefObject<T | null>) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", down);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", down); };
  }, [open, onClose, ref]);
}

/** Follow new rows only while the reader is near the bottom; otherwise show the round "jump" button (S1). */
export function useStickToBottom<T extends HTMLElement>(ref: RefObject<T | null>, dep: number) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !away) el.scrollTo({ top: el.scrollHeight });
  }, [ref, dep, away]);
  const onScroll = () => {
    const el = ref.current;
    if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  };
  return { away, onScroll, jump: () => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); setAway(false); } };
}
