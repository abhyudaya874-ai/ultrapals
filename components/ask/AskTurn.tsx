"use client";
import { Disclosure } from "@/components/ui/Disclosure";
import { IconCheck, IconReturnArrow, IconSearch } from "@/components/ui/icons";
import { formatDuration } from "@/components/thread/format";
import type { Turn } from "@/lib/research/turn";
import { AnswerText } from "./AnswerText";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const ACTION = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";

export function AskTurn({ turn, onOpenSource, onOpenSources, onFollowUp }: {
  turn: Turn; onOpenSource: (n: number) => void; onOpenSources: () => void; onFollowUp: (q: string) => void;
}) {
  const running = turn.status === "running";
  const finished = turn.ms !== undefined ? `Finished ${formatDuration(turn.ms)}` : "Finished";
  return (
    <article className="space-y-5" data-testid="turn">
      <div className="rounded-card bg-surface p-4"><p className="font-medium text-fg">{turn.question}</p></div>

      <Disclosure key={String(running)} testId="process" defaultOpen={running}
        label={running ? "Working..." : turn.status === "error" ? "Stopped" : finished}
        meta={`${turn.steps.length} step${turn.steps.length === 1 ? "" : "s"}${turn.model ? ` · ${turn.model}` : ""}`}>
        <ul className="ml-1 space-y-0.5 border-l border-line pl-4">
          {turn.steps.map((s) => (
            <li key={s.id} data-testid="step" className="flex min-h-9 items-center gap-3 rounded-lg px-2">
              <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[s.state]}`} />
              <IconSearch className="size-4 shrink-0 text-fg-muted" />
              <span className="truncate">{s.label}</span>
              {s.detail && <span className={`truncate ${s.state === "error" ? "text-bad" : "text-fg-dim"}`}>{s.detail}</span>}
              <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{s.ms !== undefined ? formatDuration(s.ms) : ""}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      {turn.reasoning && (
        <Disclosure key={`r-${turn.answer === ""}`} testId="thinking" defaultOpen={turn.answer === "" && running} label="Thinking" meta={`${turn.reasoning.length} characters`}>
          <p className="ml-1 whitespace-pre-wrap border-l border-line pl-4 text-[13px] italic leading-relaxed text-fg-dim">{turn.reasoning}</p>
        </Disclosure>
      )}

      {turn.answer && <AnswerText text={turn.answer} sources={turn.sources} onOpen={onOpenSource} />}
      {running && !turn.answer && <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />}
      {turn.status === "error" && <p role="alert" className="text-[14px] text-bad">{turn.error}</p>}

      {turn.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-testid="sources-chip" onClick={onOpenSources} className={ACTION}>
            <IconCheck className="size-4" />{turn.sources.length} sources{turn.used.length > 0 && ` · ${turn.used.length} cited`}
          </button>
          {turn.sources.slice(0, 4).map((s) => (
            <button key={s.n} type="button" onClick={() => onOpenSource(s.n)} className={`${ACTION} max-w-[11rem]`}>
              <span className="text-fg-dim">{s.n}</span><span className="truncate">{s.host}</span>
            </button>
          ))}
        </div>
      )}

      {turn.status === "done" && (
        <button type="button" onClick={() => onFollowUp(`Go deeper on: ${turn.question}`)} className="flex items-center gap-2 py-1 text-[14px] text-accent hover:underline">
          <IconReturnArrow className="size-4 shrink-0" /><span>Go deeper on this</span>
        </button>
      )}
    </article>
  );
}
