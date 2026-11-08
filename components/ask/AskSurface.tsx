"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { useDismiss, useStickToBottom } from "@/components/thread/Dock";
import { IconArrowDown, IconArrowUp } from "@/components/ui/icons";
import { applyEvent, newTurn, parseResearchStream, type Turn } from "@/lib/research/turn";
import { AskTurn } from "./AskTurn";
import { SourcePane, type SourcePaneState } from "./SourcePane";

const patch = (turns: Turn[], id: string, f: (t: Turn) => Turn) => turns.map((t) => (t.id === id ? f(t) : t));

export function AskSurface() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pane, setPane] = useState<SourcePaneState>({ kind: "closed" });
  const running = turns.some((t) => t.status === "running");
  const scroller = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const stick = useStickToBottom(scroller, turns.reduce((n, t) => n + t.answer.length + t.reasoning.length + t.steps.length, 0));
  const closePane = useCallback(() => setPane({ kind: "closed" }), []);
  useDismiss(pane.kind !== "closed", closePane, paneRef);
  useEffect(() => () => abort.current?.abort(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 3 || running) return;
    const id = crypto.randomUUID();
    const ctl = (abort.current = new AbortController());
    setInput("");
    setTurns((ts) => [...ts, newTurn(id, q)]);
    const fail = (message: string) => setTurns((ts) => patch(ts, id, (t) => applyEvent(t, { kind: "error", message })));
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }), signal: ctl.signal });
      if (!res.ok || !res.body) return fail(res.status === 429 ? "Slow down: 8 questions per minute." : `Request failed (${res.status}).`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const p = parseResearchStream((buf += dec.decode(value, { stream: true })));
        buf = p.rest;
        if (p.events.length) setTurns((ts) => patch(ts, id, (t) => p.events.reduce(applyEvent, t)));
      }
      setTurns((ts) => patch(ts, id, (t) => (t.status === "running" ? applyEvent(t, { kind: "error", message: "The stream ended early." }) : t)));
    } catch (e) {
      if (!ctl.signal.aborted) fail(e instanceof Error ? e.message : "Network error.");
    }
  }

  const paneTurn = pane.kind === "closed" ? null : turns.find((t) => t.id === pane.turnId);
  return (
    <div className={`grid h-full min-h-0 ${pane.kind === "closed" ? "grid-cols-1" : "lg:grid-cols-2"}`} data-testid="surface">
      <section className="relative flex min-h-0 min-w-0 flex-col">
        <TopBar title={turns[0]?.question ?? "Ask"} onOutline={() => paneTurn ? closePane() : turns.length && setPane({ kind: "list", turnId: turns[turns.length - 1].id })} outlineOpen={pane.kind !== "closed"} />
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={stick.onScroll} data-testid="thread" className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-[720px] space-y-10 px-6 pb-44 pt-6">
              {turns.length === 0 && (
                <div className="pt-[14vh] text-center">
                  <h2 className="font-serif text-[34px] text-fg">Ask anything</h2>
                  <p className="mt-2 text-[15px] text-fg-muted">Searches the web with Tavily and Exa, answers with a free model, and cites every source.</p>
                </div>
              )}
              {turns.map((t) => (
                <AskTurn key={t.id} turn={t} onFollowUp={(q) => void ask(q)}
                  onOpenSource={(n) => setPane({ kind: "source", turnId: t.id, n })} onOpenSources={() => setPane({ kind: "list", turnId: t.id })} />
              ))}
            </div>
          </div>
          {stick.away && (
            <button type="button" onClick={stick.jump} aria-label="Scroll to latest"
              className="absolute bottom-4 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-fg-muted shadow-lg transition-colors hover:text-fg">
              <IconArrowDown className="size-4" />
            </button>
          )}
        </div>
        <form className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
          <div data-testid="dock" className="rounded-dock border border-dock-line bg-dock p-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={400} aria-label="Ask a question" placeholder="Ask a question..."
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
              className="block min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] text-fg outline-none placeholder:text-fg-dim" />
            <div className="flex items-center">
              <span className="px-2 text-[12px] text-fg-dim">Free models · web search</span>
              <button type="submit" disabled={running || input.trim().length < 3} aria-label={running ? "Answering" : "Ask"}
                className="ml-auto grid size-10 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">
                {running ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <IconArrowUp className="size-5" />}
              </button>
            </div>
          </div>
        </form>
      </section>
      {paneTurn && (
        <div ref={paneRef} className="fixed inset-0 z-50 bg-canvas p-2 lg:static lg:z-auto lg:bg-transparent lg:p-5">
          <SourcePane sources={paneTurn.sources} active={pane.kind === "source" ? pane.n : null} onClose={closePane}
            onPick={(n) => setPane({ kind: "source", turnId: paneTurn.id, n })} />
        </div>
      )}
    </div>
  );
}
