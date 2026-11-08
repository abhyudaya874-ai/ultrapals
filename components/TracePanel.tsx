"use client";
import type { TraceEvent } from "@/lib/agent/types";

const DOT: Record<string, string> = {
  running: "animate-pulse bg-warn",
  pending: "bg-fg-dim",
  skipped: "bg-fg-dim",
  ok: "bg-ok",
  settled: "bg-ok",
  streaming: "animate-pulse bg-warn",
  error: "bg-bad",
};
const Dot = ({ s }: { s: string }) => <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s] ?? "bg-fg-dim"}`} />;
const row = "flex min-h-7 items-center gap-2 border-b border-line px-2 py-1 text-[13px] text-fg-muted"; // fixed min height: no layout shift

/** One switch, one row per event. Errors render INLINE, never as a toast or alert. */
export function TraceRow({ e }: { e: TraceEvent }) {
  switch (e.kind) {
    case "tool":
      return (
        <div className={row}>
          <Dot s={e.state} />
          <code className="font-mono text-[12.5px]">{e.name}</code>
          <span className="truncate text-fg-dim">{JSON.stringify(e.args)}</span>
          {e.error && <span className="text-bad">{e.error}</span>}
          <span className="ml-auto tabular-nums text-fg-dim">{e.ms !== undefined ? `${e.ms}ms` : ""}</span>
        </div>
      );
    case "subagent":
      return (
        <div className={`${row} rounded bg-surface-2`}>
          <Dot s={e.state} />
          <span className="rounded bg-surface px-1 font-mono text-[12.5px]">{e.agent}</span>
          <span>{e.title}</span>
          <span className="ml-auto tabular-nums text-fg-dim">{e.ms !== undefined ? `${e.ms}ms` : ""}</span>
        </div>
      );
    case "diff":
      return (
        <details className="border-b border-line px-2 py-1 text-[13px]" open={e.state === "streaming"}>
          <summary className="flex cursor-pointer items-center gap-2">
            <Dot s={e.state} />
            <code className="font-mono text-[12.5px]">{e.path}</code>
            {e.adds !== undefined && <span className="ml-auto text-ok">+{e.adds} −{e.removes ?? 0}</span>}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-surface p-2 font-mono text-[12.5px] leading-4">{e.hunks.join("\n")}</pre>
        </details>
      );
    case "thought":
      return <div className={`${row} italic text-fg-dim`}><span className="line-clamp-3">{e.text}</span></div>;
    case "verdict":
      return <div className={row}><Dot s="ok" /><span>verdict</span><code className="font-mono text-[12.5px]">{e.verdict.reason}</code></div>;
    case "done":
      return <div className={row}><Dot s="ok" /><span>done → {e.state}{e.deduped ? " (duplicate request, first result returned)" : ""}</span></div>;
    case "error":
      return <div className={`${row} text-bad`}><Dot s="error" />{e.message}</div>;
  }
}

/** Fallback flat trace list. PromiseSurface no longer renders this; kept for the pre-wire state. */
export function TracePanel({ events }: { events: TraceEvent[] }) {
  return (
    <aside className="w-full max-w-[380px] shrink-0 rounded-card border border-line bg-surface">
      <h2 className="border-b border-line px-2 py-1 text-xs font-medium uppercase tracking-wide text-fg-dim">Trace</h2>
      {events.length === 0 && <p className="px-2 py-3 text-xs text-fg-dim">Nothing yet. Settle the promise to watch it run.</p>}
      {events.map((e) => (
        <TraceRow key={e.id} e={e} />
      ))}
    </aside>
  );
}
