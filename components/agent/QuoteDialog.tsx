"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@/components/ui/icons";
import { useLast } from "@/components/ui/presence";
import type { Attachment } from "@/lib/computer/events";

/** Where a quote came from, in words: the page it was selected on. */
const fromWhere = (path: string): string => (path === "/" || path === "" ? "the chat" : path);

/**
 * The full text of a quote added to the message, shown in a dialog when its chip in the prompt box is pressed. Esc, the X or a press on the dim
 * area closes it. It is drawn in the page body, outside the panel the prompt box sits in, so a docked panel cannot clip or move it.
 */
export function QuoteDialog({ quote, onClose }: { quote: Attachment | null; onClose: () => void }) {
  const shown = useLast(quote); // the text stays while the dialog fades out
  const open = quote !== null;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    // capture phase: the chat panel closes itself on Esc, and this Esc is only for the dialog
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
  }, [open, onClose]);
  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`${open ? "fade-in" : "fade-out pointer-events-none"} fixed inset-0 z-[75] grid place-items-center bg-black/55 p-4`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="quote-title" data-testid="quote-dialog" className={`${open ? "sheet-in" : "sheet-out"} flex max-h-[80dvh] w-[min(640px,100%)] flex-col rounded-2xl border border-dock-line bg-surface shadow-2xl`}>
        <header className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-4">
          <h2 id="quote-title" className="text-[15px] font-medium text-fg">Quote</h2>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim">from {fromWhere(shown.path)}</span>
          <button ref={close} type="button" onClick={onClose} aria-label="Close" className="press grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconX className="size-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
          <p className="whitespace-pre-wrap break-words border-l-2 border-line pl-3.5 text-[14px] leading-relaxed text-fg-muted" data-testid="quote-text">{shown.text}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
