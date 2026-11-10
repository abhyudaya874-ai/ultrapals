"use client";
import { useEffect, useRef, useState } from "react";
import { useStickToBottom } from "@/components/thread/Dock";
import { IconAgent, IconArrowDown, IconArrowUp, IconPlus, IconStop, IconX } from "@/components/ui/icons";
import { PAL_NAMES } from "@/lib/computer/pals";
import { useAgent } from "./AgentProvider";
import { RunView } from "./RunView";

const HINTS = ["Why is this promise waiting?", "Build a tiny site in the terminal and open it in the browser", "Research how L402 payments work"];

/** The one chat. Lives in the shell, so it follows you across pages and sees what you select. */
export function AgentPanel() {
  const { open, toggle, runs, busy, send, stop, newChat, attachments, removeAttachment, focusTick } = useAgent();
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const size = runs.reduce((n, r) => n + r.answer.length + r.timeline.length + r.agents.reduce((m, a) => m + a.steps.length + a.terms.length, 0), 0);
  const stick = useStickToBottom(scroller, size);
  useEffect(() => { if (open) box.current?.focus(); }, [open, focusTick]);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && document.activeElement === box.current) toggle(false); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [open, toggle]);
  if (!open) return null;

  const go = () => { const m = input; setInput(""); void send(m); };
  return (
    <aside data-agent-panel data-testid="agent-panel" className="fixed inset-0 z-50 flex flex-col border-l border-line bg-sidebar lg:static lg:z-auto lg:w-[440px] lg:shrink-0">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <IconAgent className="size-4 text-fg-muted" />
        <h2 className="text-[15px] font-medium text-fg">{PAL_NAMES.main}</h2>
        <span className="text-[12px] text-fg-dim">{busy ? "working…" : "ready"}</span>
        <button type="button" onClick={newChat} aria-label="New chat" title="New chat" className="ml-auto grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconPlus className="size-4" /></button>
        <button type="button" onClick={() => toggle(false)} aria-label="Close chat" title="Close chat (Esc)" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconX className="size-4" /></button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={stick.onScroll} className="h-full overflow-y-auto" data-testid="agent-thread">
          <div className="space-y-8 px-4 pb-6 pt-4">
            {runs.length === 0 && (
              <div className="pt-10">
                <h3 className="font-serif text-[26px] leading-tight text-fg">Ask, or select anything on screen.</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">Select text on any page and press <kbd className="rounded bg-surface-2 px-1">Ctrl+L</kbd> to add it here. The agent can research the web, drive a live browser, and run commands in its own cloud computer.</p>
                <ul className="mt-5 space-y-1">
                  {HINTS.map((h) => <li key={h}><button type="button" onClick={() => { setInput(h); box.current?.focus(); }} className="py-1 text-left text-[13.5px] text-accent hover:underline">{h}</button></li>)}
                </ul>
              </div>
            )}
            {runs.map((r) => <RunView key={r.id} run={r} />)}
          </div>
        </div>
        {stick.away && (
          <button type="button" onClick={stick.jump} aria-label="Scroll to latest" className="absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-fg-muted shadow-lg hover:text-fg"><IconArrowDown className="size-4" /></button>
        )}
      </div>

      <form data-agent-dock className="shrink-0 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="rounded-dock border border-dock-line bg-dock p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
          {attachments.length > 0 && (
            <ul className="mb-1.5 flex flex-wrap gap-1.5 px-1" data-testid="attachments">
              {attachments.map((a) => (
                <li key={a.id} className="flex max-w-full items-center gap-1.5 rounded-lg bg-surface-2 py-1 pl-2 pr-1 text-[12px] text-fg-muted">
                  <span className="truncate">“{a.text.replace(/\s+/g, " ").slice(0, 60)}”</span>
                  <button type="button" onClick={() => removeAttachment(a.id)} aria-label="Remove attachment" className="grid size-5 shrink-0 place-items-center rounded hover:bg-line hover:text-fg"><IconX className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          <textarea ref={box} value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} aria-label="Message the agent"
            placeholder={busy ? "Send a follow-up when it finishes…" : "Type a command…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) go(); } }}
            className="block min-h-12 w-full resize-none bg-transparent px-1.5 py-1 text-[14px] text-fg outline-none placeholder:text-fg-dim" />
          <div className="flex items-center">
            <span className="px-1.5 text-[11.5px] text-fg-dim">Free models · cloud computer</span>
            {busy ? (
              <button type="button" onClick={stop} aria-label="Stop" className="ml-auto grid size-9 place-items-center rounded-full bg-surface-2 text-fg hover:bg-line"><IconStop className="size-4" /></button>
            ) : (
              <button type="submit" disabled={input.trim().length < 2} aria-label="Send" className="ml-auto grid size-9 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted"><IconArrowUp className="size-[18px]" /></button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
