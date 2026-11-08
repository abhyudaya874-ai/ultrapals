"use client";
import { useState } from "react";
import type { Verdict } from "@/lib/verdict";
import { TraceRow } from "@/components/TracePanel";
import { IconCheck, IconCopy, IconDownload, IconExpand, IconFile, IconShare, IconX } from "@/components/ui/icons";
import { formatDuration } from "./format";
import { formatMajor } from "@/lib/money";
import type { StepGroup, TraceView } from "./group-trace";
import type { PaneState, ThreadLogRow, ThreadPromise } from "./Thread";
import { REASON_SENTENCE } from "./reason-copy";
import { describeCondition } from "./describe-condition";

type ArtifactWhich = "verdict" | "source" | "log";
export type OpenPane = Exclude<PaneState, { kind: "closed" }>;

export interface PaneProps {
  pane: OpenPane;
  groups: StepGroup[];
  view: TraceView;
  promise: ThreadPromise;
  log: ThreadLogRow[];
  verdict: Verdict | null;
  approveUrl: string | null;
  onClose: () => void;
}

function download(name: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function PaneBtn({ onClick, children, label }: { onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid size-8 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

function AgentPane({ group }: { group: StepGroup }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="truncate text-[15px] font-medium text-fg">{group.title}</h2>
        <p className="text-[12px] text-fg-dim">
          {group.agent ?? "run"} · {group.state === "running" ? "running" : group.ms !== undefined ? `finished ${formatDuration(group.ms)}` : group.state}
          {group.items.filter((i) => i.kind === "tool").length > 0 && ` · ${group.items.filter((i) => i.kind === "tool").length} tool calls`}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {group.items.length === 0 && <p className="px-2 py-3 text-[13px] text-fg-dim">No steps recorded for this agent.</p>}
        <ul>
          {group.items.map((i) => (
            <li key={i.id}><TraceRow e={i} /></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function VerdictBrief({ promise, verdict, currency }: { promise: ThreadPromise; verdict: Verdict; currency: string }) {
  return (
    <article className="font-serif text-[16px] leading-[1.7] text-fg">
      <h2 className="mb-3 font-sans text-[15px] font-medium">Verdict brief</h2>
      <dl className="space-y-2 font-sans text-[13px]">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Promise</dt><dd>{promise.title}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Terms</dt><dd>{promise.amountLabel} · window ends {new Date(promise.windowEndsAtIso).toLocaleString()}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Condition</dt><dd>{describeCondition(promise.condition)}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Sentence</dt><dd>{REASON_SENTENCE[verdict.reason]}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Verdict</dt><dd><code className="font-mono text-[12.5px]">{verdict.reason}</code> → {verdict.consequence} <span className="text-fg-dim">({verdict.kind})</span></dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Committed</dt><dd>{formatMajor(verdict.diag.committedMinor, currency)} {currency}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Observed</dt><dd>{verdict.diag.observedMinor === null ? "none" : `${formatMajor(verdict.diag.observedMinor, currency)} ${currency}`}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-dim">Window</dt><dd>{verdict.diag.windowClosed ? "closed" : "open"} at {new Date(verdict.diag.windowEndsAtMs).toLocaleString()}</dd></div>
      </dl>
    </article>
  );
}

function SourceView({ view }: { view: TraceView }) {
  const d = view.diff;
  if (!d) return <p className="p-4 text-[13px] text-fg-dim">No source was streamed for this run.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[12.5px] text-fg">
        <IconFile className="size-4 text-fg-muted" />
        <span>decide() · {d.path}</span>
        <span className="ml-auto text-ok">+{d.adds ?? d.hunks.length} -{d.removes ?? 0}</span>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[12.5px] leading-5">
        {d.hunks.map((line, i) => (
          <div key={i} className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-fg-dim">{i + 1}</span>
            <span className="whitespace-pre text-fg">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function LogView({ log }: { log: ThreadLogRow[] }) {
  if (log.length === 0) return <p className="p-4 text-[13px] text-fg-dim">No events yet.</p>;
  return (
    <ul>
      {log.map((l) => (
        <li key={l.id} className="flex min-h-7 items-center gap-2 border-b border-line px-2 py-1 text-[13px] text-fg-muted">
          <code className="font-mono text-[12.5px]">{l.kind}</code>
          <span className="text-fg-dim">attempt {l.attempt}</span>
          <span className="ml-auto tabular-nums text-fg-dim">{new Date(l.createdAtIso).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

const TITLES: Record<ArtifactWhich, string> = { verdict: "Verdict brief", source: "decide() source", log: "Event log" };

export function Pane({ pane, groups, view, promise, log, verdict, approveUrl, onClose }: PaneProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const group = pane.kind === "agent" ? groups.find((g) => g.id === pane.id) ?? null : null;
  const which: ArtifactWhich | null = pane.kind === "artifact" ? pane.which : null;

  const brief = verdict ? JSON.stringify({ promise: { title: promise.title, amountLabel: promise.amountLabel, windowEndsAt: promise.windowEndsAtIso, state: promise.state, condition: promise.condition }, verdict }, null, 2) : null;
  const srcText = view.diff?.hunks.join("\n") ?? null;

  async function copyText(text: string, done?: () => void) {
    try { await navigator.clipboard.writeText(text); done?.(); } catch { /* clipboard unavailable */ }
  }
  function flash() { setCopied(true); setTimeout(() => setCopied(false), 1500); }

  const body = pane.kind === "agent"
    ? (group ? <AgentPane group={group} /> : <p className="p-4 text-[13px] text-fg-dim">This agent has no recorded steps.</p>)
    : which === "verdict"
      ? (verdict ? <VerdictBrief promise={promise} verdict={verdict} currency={promise.currency} /> : <p className="p-4 text-[13px] text-fg-dim">No verdict yet.</p>)
      : which === "source"
        ? <SourceView view={view} />
        : <LogView log={log} />;

  const isArtifact = pane.kind === "artifact";

  return (
    <>
      {expanded && <button type="button" aria-label="Close expanded pane" className="fixed inset-0 z-40 bg-black/50" onClick={() => setExpanded(false)} />}
      <div data-testid="pane"
        className={expanded
          ? "fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:inset-6"
          : "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface"}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">
            {pane.kind === "agent" ? (group?.title ?? "Agent") : TITLES[which ?? "log"]}
          </h2>
          {isArtifact && (
            <>
              {which === "verdict" && brief && (
                <>
                  <PaneBtn label={copied ? "Copied" : "Copy verdict JSON"} onClick={() => copyText(brief, flash)}>{copied ? <IconCheck className="size-4 text-ok" /> : <IconCopy className="size-4" />}</PaneBtn>
                  <PaneBtn label="Download verdict JSON" onClick={() => download(`verdict-${promise.id}.json`, brief)}><IconDownload className="size-4" /></PaneBtn>
                  <PaneBtn label="Copy link" onClick={() => copyText(location.href)}><IconShare className="size-4" /></PaneBtn>
                </>
              )}
              {which === "source" && srcText && (
                <>
                  <PaneBtn label="Copy source" onClick={() => copyText(srcText)}><IconCopy className="size-4" /></PaneBtn>
                  <PaneBtn label="Download source" onClick={() => download("decide.ts", srcText, "text/plain")}><IconDownload className="size-4" /></PaneBtn>
                </>
              )}
              {which === "log" && log.length > 0 && (
                <PaneBtn label="Download event log" onClick={() => download(`events-${promise.id}.json`, JSON.stringify(log, null, 2))}><IconDownload className="size-4" /></PaneBtn>
              )}
              <PaneBtn label="Expand" onClick={() => setExpanded(true)}><IconExpand className="size-4" /></PaneBtn>
            </>
          )}
          <PaneBtn label="Close pane" onClick={onClose}><IconX className="size-4" /></PaneBtn>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {body}
        </div>
      </div>
    </>
  );
}
