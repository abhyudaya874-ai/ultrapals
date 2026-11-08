"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { PromiseState } from "@/db/schema";
import type { TraceEvent } from "@/lib/agent/types";
import { parseSse, upsertEvent } from "@/lib/sse";
import type { Condition, Verdict } from "@/lib/verdict";
import { Dock, useDismiss, useStickToBottom } from "./thread/Dock";
import { groupTrace } from "./thread/group-trace";
import { sourcesFromTrace } from "./thread/safe-url";
import { Outline } from "./thread/Outline";
import { Pane } from "./thread/Pane";
import { Thread, type PaneState } from "./thread/Thread";
import { TopBar } from "./shell/TopBar";
import { IconArrowDown, IconPlus } from "./ui/icons";

export interface SurfaceProps {
  promise: { id: string; title: string; amountLabel: string; currency: string; windowEndsAtIso: string; state: PromiseState; conditionKind: "none" | "price_at_most" | "page_contains"; condition: Condition };
  approveUrl: string | null;
  log: { id: string; kind: string; attempt: number; createdAtIso: string }[];
  verdict: Verdict | null;
}

export function PromiseSurface(props: SurfaceProps) {
  const router = useRouter();
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(props.verdict);
  const [state, setState] = useState<PromiseState>(props.promise.state);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [pane, setPane] = useState<PaneState>({ kind: "closed" });
  const [outline, setOutline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false); // synchronous guard: a state flag is too slow for a fast double click
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);
  useDismiss(pane.kind !== "closed", () => setPane({ kind: "closed" }), paneRef);

  const lastAttempt = Math.max(1, ...props.log.map((l) => l.attempt));
  const attempt = state === "declined" ? lastAttempt + 1 : lastAttempt;

  function apply(e: TraceEvent) {
    setTrace((t) => upsertEvent(t, e));
    if (e.kind === "verdict") setVerdict(e.verdict);
    if (e.kind === "done") setState(e.state);
  }

  async function settle() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setTrace([]);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/promise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "settle", promiseId: props.promise.id, attempt }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = parseSse(buf);
        buf = rest;
        events.forEach(apply);
      }
    } catch (err) {
      // stream dropped: events already shown stay; the DB is the truth, refresh recovers it
      apply({ kind: "error", id: "client", message: err instanceof Error ? err.message : "stream dropped", retryable: true });
    } finally {
      busy.current = false;
      setRunning(false);
      setElapsedMs(performance.now() - t0);
      window.dispatchEvent(new Event("promises:changed"));
      router.refresh();
    }
  }

  const done = state === "captured" || state === "released";

  // "Call it twice and diff": recompute the stored verdict from its stored input. No vendor is called.
  const [replay, setReplay] = useState<string | null>(null);
  async function runReplay() {
    const res = await fetch(`/api/verdict/replay?promiseId=${props.promise.id}`);
    const j = (await res.json()) as { identical?: boolean; error?: string };
    setReplay(j.error ?? (j.identical ? "Replay identical: same input, same verdict ✓" : "Replay DIFFERS ✗"));
  }

  // Degraded path: vendors down, a person types what they saw.
  const [manual, setManual] = useState("");
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  async function saveManual() {
    const body =
      props.promise.conditionKind === "price_at_most"
        ? { op: "manual_fact", promiseId: props.promise.id, priceMajor: manual, inStock: true }
        : { op: "manual_fact", promiseId: props.promise.id, text: manual };
    const res = await fetch("/api/promise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json()) as { error?: string };
    setManualMsg(res.ok ? "Saved. Settle again to use it." : (j.error ?? "failed"));
  }

  const view = useMemo(() => groupTrace(trace), [trace]);
  const sources = useMemo(() => sourcesFromTrace(trace), [trace]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, trace.length);
  const statusLine = `${props.promise.amountLabel} · window ends ${new Date(props.promise.windowEndsAtIso).toLocaleString()} · ${state}`;
  const manualInput = props.promise.conditionKind !== "none" && !done ? (
    <div className="space-y-1">
      <p className="text-[12px] text-fg-dim">If the vendors are down, enter what you saw ({props.promise.conditionKind === "price_at_most" ? "the price" : "the page text"}):</p>
      <div className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Manual evidence"
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-canvas px-3 text-[13px] outline-none placeholder:text-fg-dim" />
        <button onClick={saveManual} disabled={!manual} className="h-9 shrink-0 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:bg-surface-2 disabled:opacity-50">Save</button>
      </div>
      {manualMsg && <p className="text-[12px] text-fg-muted">{manualMsg}</p>}
    </div>
  ) : undefined;
  const dockMenu = (props.approveUrl && !done) || verdict ? (
    <div ref={menuRef} className="relative">
      <button type="button" aria-label="More actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
        <IconPlus className="size-5" />
      </button>
      {menuOpen && (
        <div className="absolute bottom-12 left-0 z-30 w-60 rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {props.approveUrl && !done && (
            <a href={props.approveUrl} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              Approve in PayPal sandbox
            </a>
          )}
          {verdict && (
            <button type="button" onClick={() => { setMenuOpen(false); void runReplay(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              Replay verdict
            </button>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`grid h-full min-h-0 ${pane.kind === "closed" ? "grid-cols-1" : "lg:grid-cols-2"}`} data-testid="surface">
      <section className="relative flex min-h-0 min-w-0 flex-col">
        <TopBar title={props.promise.title} onOutline={() => setOutline((o) => !o)} outlineOpen={outline} />
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={stick.onScroll} data-testid="thread" className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-[720px] space-y-6 px-6 pb-44 pt-6">
              <Thread
                promise={props.promise}
                trace={trace}
                log={props.log}
                verdict={verdict}
                running={running}
                elapsedMs={elapsedMs}
                approveUrl={props.approveUrl}
                replay={replay}
                onReplay={() => void runReplay()}
                onOpenPane={(p) => { setPane(p); setOutline(false); }}
                onShowSources={() => setOutline(true)}
              />
            </div>
          </div>
          {stick.away && (
            <button type="button" onClick={stick.jump} aria-label="Scroll to latest"
              className="absolute bottom-4 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-fg-muted shadow-lg transition-colors hover:text-fg">
              <IconArrowDown className="size-4" />
            </button>
          )}
        </div>
        <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
          <Dock statusLine={running ? "Settling…" : statusLine} manual={manualInput} menu={dockMenu}
            running={running} disabled={done} label={running ? "Settling" : state === "capture_pending" ? "Check capture" : "Settle promise"}
            onSettle={() => void settle()} />
        </div>
        {outline && (
          <Outline
            groups={view.groups}
            sources={sources}
            approveUrl={props.approveUrl}
            hasVerdict={!!verdict}
            hasDiff={!!view.diff}
            hasLog={props.log.length > 0}
            onPickAgent={(id) => setPane({ kind: "agent", id })}
            onPickArtifact={(which) => setPane({ kind: "artifact", which })}
            onClose={() => setOutline(false)}
          />
        )}
      </section>
      {pane.kind !== "closed" && (
        <div ref={paneRef} className="fixed inset-0 z-50 bg-canvas p-2 lg:static lg:z-auto lg:bg-transparent lg:p-5">
            <Pane
              pane={pane}
              groups={view.groups}
              view={view}
              promise={props.promise}
              log={props.log}
              verdict={verdict}
              approveUrl={props.approveUrl}
              onClose={() => setPane({ kind: "closed" })}
            />
          </div>
      )}
    </div>
  );
}
