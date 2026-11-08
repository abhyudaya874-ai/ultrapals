"use client";
import { useCallback, useEffect, useState } from "react";
import { useAgent } from "./AgentProvider";

interface Sel {
  text: string;
  x: number;
  y: number;
}

const inDock = (n: Node | null) => !!(n instanceof Element ? n : n?.parentElement)?.closest("[data-agent-dock], textarea, input, [contenteditable=true]");

/**
 * Devin-style "Add to chat": select text anywhere, press Ctrl+L (or click the pill) and it is attached to the agent chat
 * together with the page it came from. Ctrl+L with no selection just toggles the chat.
 */
export function SelectionPopover() {
  const { addAttachment, toggle } = useAgent();
  const [sel, setSel] = useState<Sel | null>(null);

  const read = useCallback((): Sel | null => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) return null;
    const text = s.toString().trim();
    if (text.length < 2 || inDock(s.anchorNode) || inDock(s.focusNode)) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const x = Math.min(Math.max(r.left + r.width / 2, 72), window.innerWidth - 72);
    const y = Math.min(Math.max(r.top > 64 ? r.top - 8 : r.bottom + 44, 44), window.innerHeight - 12);
    return { text, x, y };
  }, []);

  useEffect(() => {
    const update = () => setSel(read());
    const onUp = () => setTimeout(update, 0);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const cur = read();
        if (cur) {
          addAttachment(cur.text, `${location.pathname}${location.search}`);
          window.getSelection()?.removeAllRanges();
          setSel(null);
        } else toggle();
      } else if (e.key === "Escape") setSel(null);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    const onChange = () => { if (!window.getSelection()?.toString()) setSel(null); };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [read, addAttachment, toggle]);

  if (!sel) return null;
  return (
    <button
      type="button"
      data-testid="add-to-chat"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        addAttachment(sel.text, `${location.pathname}${location.search}`);
        window.getSelection()?.removeAllRanges();
        setSel(null);
      }}
      style={{ left: sel.x, top: sel.y }}
      className="fixed z-[60] flex -translate-x-1/2 -translate-y-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-fg shadow-xl transition-colors hover:bg-surface-2"
    >
      Add to chat <kbd className="hidden font-sans text-fg-dim sm:inline">Ctrl+L</kbd>
    </button>
  );
}
