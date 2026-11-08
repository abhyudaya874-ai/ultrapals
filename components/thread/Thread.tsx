"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PromiseState } from "@/db/schema";
import type { TraceEvent } from "@/lib/agent/types";
import type { Condition, Verdict } from "@/lib/verdict";
import { TraceRow } from "@/components/TracePanel";
import { Disclosure } from "@/components/ui/Disclosure";
import { IconAgent, IconCheck, IconChevronRight, IconClock, IconCopy, IconFile, IconReturnArrow } from "@/components/ui/icons";
import { describeCondition } from "./describe-condition";
import { formatDuration } from "./format";
import { durationFromLog, groupTrace, processCounts, stepSummary } from "./group-trace";
import { REASON_SENTENCE } from "./reason-copy";
import { sourcesFromTrace } from "./safe-url";

export type PaneState = { kind: "closed" } | { kind: "agent"; id: string } | { kind: "artifact"; which: "verdict" | "source" | "log" };

export interface ThreadPromise {
  id: string;
  title: string;
  amountLabel: string;
  currency: string;
  windowEndsAtIso: string;
  state: PromiseState;
  condition: Condition;
}
export interface ThreadLogRow { id: string; kind: string; attempt: number; createdAtIso: string }

export interface ThreadProps {
  promise: ThreadPromise;
  trace: TraceEvent[];
  log: ThreadLogRow[];
  verdict: Verdict | null;
  running: boolean;
  elapsedMs: number | null;
  approveUrl: string | null;
  replay: string | null;
  onReplay: () => void;
  onOpenPane: (p: Exclude<PaneState, { kind: "closed" }>) => void;
  onShowSources: () => void;
}

const TONE: Record<Verdict["kind"], string> = { met: "text-ok", indeterminate: "text-warn", unmet: "text-bad" };
const SDOT: Record<string, string> = {
  running: "animate-pulse bg-warn",
  pending: "bg-fg-dim",
  skipped: "bg-fg-dim",
  ok: "bg-ok",
  settled: "bg-ok",
  streaming: "animate-pulse bg-warn",
  error: "bg-bad",
};
const StateDot = ({ s }: { s: string }) => <span className={`inline-block size-2 shrink-0 rounded-full ${SDOT[s] ?? "bg-fg-dim"}`} />;

function TermsBubble({ promise }: { promise: ThreadPromise }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = textRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, []);
  return (
    <div className="rounded-card bg-surface p-4">
      <p className="font-medium text-fg">{promise.title}</p>
      <p ref={textRef} className={`mt-1 text-[14px] leading-relaxed text-fg-muted ${open ? "" : "line-clamp-3"}`}>
        {promise.amountLabel} · window ends {new Date(promise.windowEndsAtIso).toLocaleString()} · {promise.state}. {describeCondition(promise.condition)}
      </p>
      {(clamped || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[13px] text-accent hover:underline">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

function FollowUp({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls = "flex items-center gap-2 py-1 text-[14px] text-accent hover:underline";
  const inner = <><IconReturnArrow className="size-4 shrink-0" /><span>{children}</span></>;
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

export function Thread(p: ThreadProps) {
  const view = useMemo(() => groupTrace(p.trace), [p.trace]);
  const sentence = view.explanation ?? (p.verdict ? REASON_SENTENCE[p.verdict.reason] : null);
  const sources = useMemo(() => sourcesFromTrace(p.trace), [p.trace]);
  const sourceCount = sources.length + (p.approveUrl ? 1 : 0);
  const [copied, setCopied] = useState(false);

  async function copyVerdict() {
    if (!p.verdict) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(p.verdict, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the verdict is still on screen */ }
  }

  const showProcess = p.running || view.groups.length > 0 || p.log.length > 0;

  return (
    <div className="space-y-5">
      <TermsBubble promise={p.promise} />

      {showProcess && (
        <Disclosure key={String(p.running)} testId="process" defaultOpen={p.running}
          label={p.running ? "Working..." : `Finished ${formatDuration(p.elapsedMs ?? durationFromLog(p.log) ?? 0)}`}
          meta={view.groups.length > 0 ? processCounts(view.groups) : `${p.log.length} event${p.log.length === 1 ? "" : "s"}`}>
          {view.groups.length > 0 ? (
            <ul className="ml-1 space-y-0.5 border-l border-line pl-4">
              {view.groups.map((g) => (
                <li key={g.id}>
                  <button type="button" data-testid="agent-row" onClick={() => p.onOpenPane({ kind: "agent", id: g.id })}
                    className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2">
                    <StateDot s={g.state} /><IconAgent className="size-4 shrink-0 text-fg-muted" />
                    <span className="truncate">{g.title}</span>
                    <span className="truncate text-fg-dim">{stepSummary(g)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{g.ms !== undefined ? formatDuration(g.ms) : ""}</span>
                  </button>
                  {g.items.filter((i) => i.kind === "tool" && i.state === "error").map((i) => <TraceRow key={i.id} e={i} />)}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="ml-1 space-y-0.5 border-l border-line pl-4">
              {p.log.map((l) => (
                <li key={l.id} className="flex min-h-7 items-center gap-2 px-2 text-[13px] text-fg-muted">
                  <code className="font-mono text-[12.5px]">{l.kind}</code>
                  <span className="text-fg-dim">attempt {l.attempt}</span>
                  <span className="ml-auto tabular-nums text-fg-dim">{new Date(l.createdAtIso).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      )}

      {view.diff && (
        <button type="button" data-testid="source-card" onClick={() => p.onOpenPane({ kind: "artifact", which: "source" })}
          className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2"><IconFile className="size-4 text-fg-muted" /></span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-[12.5px] text-fg">decide() · {view.diff.path}</span>
            <span className="block text-[12px] text-fg-dim">Document</span>
          </span>
          <span className="ml-auto shrink-0 text-ok">+{view.diff.adds ?? view.diff.hunks.length} -{view.diff.removes ?? 0}</span>
          <IconChevronRight className="size-4 shrink-0 text-fg-dim" />
        </button>
      )}

      {p.verdict && (
        <button type="button" data-testid="verdict-card" onClick={() => p.onOpenPane({ kind: "artifact", which: "verdict" })}
          className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2"><IconCheck className="size-4 text-ok" /></span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] text-fg">Verdict brief</span>
            <span className="block text-[12px] text-fg-dim">Document</span>
          </span>
          <IconChevronRight className="ml-auto size-4 shrink-0 text-fg-dim" />
        </button>
      )}

      <section data-testid="answer" className="font-serif text-[17px] leading-[1.65] text-fg">
        {p.verdict ? (
          <>
            <p>{sentence}</p>
            <div className={`mt-3 flex items-center gap-2 font-sans text-[13px] ${TONE[p.verdict.kind]}`}>
              <span className="size-2 rounded-full bg-current" />
              <code className="font-mono text-[12.5px]">{p.verdict.reason}</code>
              <span className="text-fg-muted">→ {p.verdict.consequence}</span>
            </div>
          </>
        ) : (
          <p className="text-fg-muted">No verdict yet. Settle the promise and watch it run.</p>
        )}
      </section>

      {p.verdict && (
        <div className="flex flex-wrap items-center gap-2" data-testid="actions">
          <ActionBtn onClick={copyVerdict}>
            {copied ? <IconCheck className="size-4 text-ok" /> : <IconCopy className="size-4" />}
            {copied ? "Copied" : "Copy verdict"}
          </ActionBtn>
          <ActionBtn onClick={p.onReplay}>
            <IconClock className="size-4" />
            Replay verdict
          </ActionBtn>
          {sourceCount > 0 && (
            <ActionBtn onClick={p.onShowSources}>
              <span className="flex -space-x-1">
                {sources.slice(0, 3).map((s) => (
                  <span key={s.url.href} className="grid size-4 place-items-center rounded-full border border-line bg-surface-2 text-[9px] uppercase text-fg-muted">{s.host[0]}</span>
                ))}
                {p.approveUrl && <span className="grid size-4 place-items-center rounded-full border border-line bg-surface-2 text-[9px] uppercase text-fg-muted">P</span>}
              </span>
              {sourceCount} source{sourceCount === 1 ? "" : "s"}
            </ActionBtn>
          )}
          {p.replay && <span className="px-1 text-[13px] text-fg-muted" data-testid="replay-line">{p.replay}</span>}
        </div>
      )}

      <div className="space-y-0.5" data-testid="follow-ups">
        <FollowUp href="/board">Open dashboard</FollowUp>
        <FollowUp href="/timeline">See on timeline</FollowUp>
        {p.verdict && <FollowUp onClick={p.onReplay}>Replay verdict</FollowUp>}
      </div>
    </div>
  );
}
