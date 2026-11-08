"use client";
import { formatDuration } from "@/components/thread/format";
import { Disclosure } from "@/components/ui/Disclosure";
import { IconAgent, IconDollar, IconFile, IconGlobe, IconSearch, IconTerminal } from "@/components/ui/icons";
import type { AgentRole } from "@/lib/computer/events";
import { subagents, type AgentRow, type Run } from "@/lib/computer/run";
import { AnswerText } from "./AnswerText";
import { useAgent } from "./AgentProvider";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const ICON: Record<AgentRole, typeof IconAgent> = { main: IconAgent, research: IconSearch, browser: IconGlobe, terminal: IconTerminal, promise: IconDollar };
const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";

const nameOf = (id: string) => (id === "main" ? "Computer" : id.replace(/-\d+$/, "").replace(/^./, (c) => c.toUpperCase()));

function summary(a: AgentRow): string {
  const last = [...a.steps].reverse().find((s) => s.state !== "running") ?? a.steps.at(-1);
  return last?.label ?? "Starting…";
}

export function RunView({ run }: { run: Run }) {
  const { openWorkspace, liveViewUrl } = useAgent();
  const running = run.status === "running";
  const subs = subagents(run);
  const files = subs.flatMap((a) => a.files);
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const removes = files.reduce((n, f) => n + f.removes, 0);
  const terms = subs.flatMap((a) => a.terms).length;
  const main = run.agents.find((a) => a.id === "main");
  const thinking = (main?.reasoning ?? "") + subs.map((a) => a.reasoning).join("");

  return (
    <article className="space-y-4" data-testid="run">
      <div className="rounded-card bg-surface p-3.5">
        {run.attachments.map((a) => (
          <blockquote key={a.id} className="mb-2 line-clamp-3 border-l-2 border-line pl-2.5 text-[12.5px] italic text-fg-muted">{a.text}</blockquote>
        ))}
        <p className="whitespace-pre-wrap text-[14px] font-medium text-fg">{run.prompt}</p>
      </div>

      {run.timeline.some((t) => t.t === "message" || run.agents.find((a) => a.id === t.id)?.role !== "main") && (
        <Disclosure key={String(running)} testId="process" defaultOpen={running}
          label={running ? "Working..." : run.status === "error" ? "Stopped" : `Finished ${formatDuration(run.ms ?? 0)}`}
          meta={`${subs.length} agent${subs.length === 1 ? "" : "s"}${run.model ? ` · ${run.model}` : ""}`}>
          <ul className="ml-1 space-y-0.5 border-l border-line pl-3.5">
            {run.timeline.map((t) => {
              if (t.t === "message") {
                const m = run.messages.find((x) => x.id === t.id);
                if (!m) return null;
                const out = m.from === "main";
                return (
                  <li key={t.id}>
                    <Disclosure label={out ? `Sent agent message to ${nameOf(m.to)}` : `Message from ${nameOf(m.from)}`}>
                      <p className="whitespace-pre-wrap pb-2 pl-1 text-[12.5px] leading-relaxed text-fg-dim">{m.text}</p>
                    </Disclosure>
                  </li>
                );
              }
              const a = run.agents.find((x) => x.id === t.id);
              if (!a || a.role === "main") return null;
              const Icon = ICON[a.role];
              return (
                <li key={t.id}>
                  <button type="button" data-testid="agent-row" onClick={() => openWorkspace(a.role === "browser" ? "browser" : a.role === "terminal" ? "terminal" : "agent", a.id)}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] hover:bg-surface-2">
                    <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[a.state]}`} />
                    <Icon className="size-4 shrink-0 text-fg-muted" />
                    <span className="shrink-0">{a.title}</span>
                    <span className="truncate text-fg-dim">{summary(a)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{a.ms !== undefined ? formatDuration(a.ms) : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      {thinking && (
        <Disclosure key={`t-${run.answer === ""}`} testId="thinking" defaultOpen={running && run.answer === ""} label="Thinking" meta={`${thinking.length} characters`}>
          <p className="ml-1 max-h-48 overflow-y-auto whitespace-pre-wrap border-l border-line pl-3.5 text-[12.5px] italic leading-relaxed text-fg-dim">{thinking}</p>
        </Disclosure>
      )}

      {files.length > 0 && (
        <button type="button" data-testid="files-card" onClick={() => openWorkspace("files")} className="flex w-full items-center gap-3 rounded-card bg-surface p-3 text-left hover:bg-surface-2">
          <span className="grid size-9 place-items-center rounded-lg bg-surface-2"><IconFile className="size-4 text-fg-muted" /></span>
          <span>
            <span className="block text-[13.5px] font-medium text-fg">Edited {files.length} file{files.length === 1 ? "" : "s"}</span>
            <span className="text-[12.5px]"><span className="text-ok">+{adds}</span> <span className="text-bad">-{removes}</span></span>
          </span>
        </button>
      )}

      {run.answer && <AnswerText text={run.answer} sources={run.sources} onOpen={() => openWorkspace("sources")} />}
      {running && !run.answer && <div className="h-4 w-36 animate-pulse rounded bg-surface-2" />}
      {run.status === "error" && <p role="alert" className="text-[13.5px] text-bad">{run.error}</p>}

      {(run.sources.length > 0 || liveViewUrl || terms > 0) && (
        <div className="flex flex-wrap gap-2">
          {run.sources.length > 0 && <button type="button" data-testid="sources-chip" onClick={() => openWorkspace("sources")} className={CHIP}>{run.sources.length} sources{run.used.length > 0 && ` · ${run.used.length} cited`}</button>}
          {liveViewUrl && <button type="button" onClick={() => openWorkspace("browser")} className={CHIP}><IconGlobe className="size-4" />Browser</button>}
          {terms > 0 && <button type="button" onClick={() => openWorkspace("terminal")} className={CHIP}><IconTerminal className="size-4" />{terms} command{terms === 1 ? "" : "s"}</button>}
        </div>
      )}
    </article>
  );
}
