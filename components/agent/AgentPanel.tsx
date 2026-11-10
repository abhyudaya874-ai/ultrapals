"use client";
import { useEffect, useRef } from "react";
import { useStickToBottom } from "@/components/thread/Dock";
import { IconAgent, IconArrowDown, IconPlus, IconX } from "@/components/ui/icons";
import { PAL_NAMES } from "@/lib/computer/pals";
import { Rail, ResizeHandle, useResizable } from "@/components/shell/Resizable";
import { useAgent } from "./AgentProvider";
import { PromptBox } from "./PromptBox";
import { RunView } from "./RunView";

const HINTS = ["Why is this promise waiting?", "Build a tiny site in the terminal and open it in the browser", "Research how L402 payments work"];

/** UltraPal docked beside any other page (a promise, the form). It shares one conversation with the home screen. */
export function AgentPanel() {
  const { open, toggle, runs, busy, newChat, send } = useAgent();
  const rs = useResizable("dock", "right");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const size = runs.reduce((n, r) => n + r.answer.length + r.timeline.length + r.agents.reduce((m, a) => m + a.steps.length + a.terms.length + a.files.length, 0), 0);
  const stick = useStickToBottom(scroller, size);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && document.activeElement === box.current) toggle(false); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [open, toggle]);
  if (!open) return null;

  return (
    <>
    <ResizeHandle r={rs} label="chat" side="right" />
    {rs.collapsed && <Rail title="UltraPal" side="right" onOpen={() => rs.setCollapsed(false)} />}
    <aside data-agent-panel data-testid="agent-panel" style={rs.style} className={`fixed inset-0 z-50 flex flex-col bg-sidebar lg:static lg:z-auto lg:w-[var(--panel-w)] lg:shrink-0 ${rs.dragging ? "" : "lg:transition-[width] lg:duration-200"} ${rs.collapsed ? "lg:hidden" : ""}`}>
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
                  {HINTS.map((h) => <li key={h}><button type="button" disabled={busy} onClick={() => void send(h)} className="py-1 text-left text-[13.5px] text-accent hover:underline">{h}</button></li>)}
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
      <div className="shrink-0 px-3 pb-3"><PromptBox variant="dock" boxRef={box} /></div>
    </aside>
    </>
  );
}
