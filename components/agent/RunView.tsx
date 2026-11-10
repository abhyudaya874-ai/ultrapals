"use client";
import { formatDuration } from "@/components/thread/format";
import { Disclosure } from "@/components/ui/Disclosure";
import { Pill } from "@/components/ui/Pill";
import { IconAgent, IconMail, IconDollar, IconFile, IconGlobe, IconList, IconSearch, IconTerminal } from "@/components/ui/icons";
import type { AgentRole } from "@/lib/computer/events";
import { palName } from "@/lib/computer/pals";
import { disclosureRows, processLabel } from "@/lib/computer/process";
import { subagents, type AgentRow, type Run } from "@/lib/computer/run";
import { AnswerText } from "./AnswerText";
import { ExamPanel } from "./ExamPanel";
import { SituationPanel } from "./SituationPanel";
import { SearchedSites } from "./SearchedSites";
import { SourceStack } from "@/components/ui/SiteChip";
import { groupVisits } from "@/lib/computer/visits";
import { useAgent } from "./AgentProvider";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const ICON: Record<AgentRole, typeof IconAgent> = { main: IconAgent, research: IconSearch, browser: IconGlobe, terminal: IconTerminal, promise: IconDollar, rival: IconList, superpal: IconList, situation: IconList, sandbox: IconTerminal };
const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";

const nameOf = palName;

function summary(a: AgentRow): string {
  const last = [...a.steps].reverse().find((s) => s.state !== "running") ?? a.steps.at(-1);
  return last?.label ?? "Starting…";
}

export function RunView({ run }: { run: Run }) {
  const { openWorkspace, liveViewUrl, send, busy } = useAgent();
  const running = run.status === "running";
  const subs = subagents(run);
  const files = subs.flatMap((a) => a.files);
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const removes = files.reduce((n, f) => n + f.removes, 0);
  const terms = subs.flatMap((a) => a.terms).length;
  const main = run.agents.find((a) => a.id === "main");
  const rows = disclosureRows(run);
  const grouped = groupVisits(run.visits);
  const pages = grouped.pages;
  const now = running ? [...subs].reverse().flatMap((a) => a.steps).find((st) => st.state === "running")?.label : undefined;
  const thinking = (main?.reasoning ?? "") + subs.map((a) => a.reasoning).join("");

  return (
    <article className="space-y-4" data-testid="run">
      <div className="rounded-card bg-surface p-3.5">
        {run.attachments.map((a) => (
          <blockquote key={a.id} className="mb-2 line-clamp-3 border-l-2 border-line pl-2.5 text-[12.5px] italic text-fg-muted">{a.text}</blockquote>
        ))}
        <p className="whitespace-pre-wrap text-[14px] font-medium text-fg">{run.prompt}</p>
      </div>

      <p className="text-[13px] text-fg-muted" data-testid="run-status" aria-live="polite">
        {running ? "Working…" : run.status === "error" ? "Stopped" : `Finished ${formatDuration(run.ms ?? 0)}`}
        {running && now && <span className="text-fg-dim"> · {now}</span>}
      </p>

      {(rows.length > 0 || run.visits.length > 0) && (
        <Disclosure key={String(running)} testId="process" defaultOpen={running} label={processLabel(run)} meta={`${subs.length} agent${subs.length === 1 ? "" : "s"}${run.model ? ` · ${run.model}` : ""}`}>
          <ul className="ml-1 space-y-1 border-l border-line pl-3.5">
            <SearchedSites visits={run.visits} running={running} />
            {run.timeline.map((t) => {
              if (t.t === "message") {
                const m = run.messages.find((x) => x.id === t.id);
                if (!m) return null;
                const out = m.id.startsWith("to-"); // ids are to-<agent> going down, from-<agent> coming back
                const who = out ? m.to : m.from;
                return (
                  <li key={t.id} className="rise flex min-h-9 flex-wrap items-center gap-2 px-2 text-[13.5px] text-fg-muted" data-testid="message-row">
                    <IconMail className="size-4 shrink-0" />
                    <span>{out ? "Sent agent message to" : "Message from"}</span>
                    <Pill name={nameOf(who)} icon={<IconAgent className="size-3.5 text-fg-muted" />}>{m.text}</Pill>
                  </li>
                );
              }
              const row = rows.find((r) => r.agent.id === t.id);
              if (!row) return null;
              const a = row.agent;
              const Icon = ICON[a.role];
              return (
                <li key={a.id} className="rise" style={{ marginLeft: row.depth * 16 }}>
                  <button type="button" data-testid="agent-row" onClick={() => openWorkspace(a.role === "browser" ? "browser" : a.role === "terminal" ? "terminal" : "agent", a.id)}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] hover:bg-surface-2">
                    <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[a.state]}`} />
                    <Icon className="size-4 shrink-0 text-fg-muted" />
                    <span className="shrink-0 text-fg">{a.title}</span>
                    <span className="truncate text-fg-dim">{summary(a)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{a.ms !== undefined ? formatDuration(a.ms) : ""}</span>
                  </button>
                </li>
              );
            })}
            {run.spawns.filter((x) => x.decision === "denied").map((x) => (
              <li key={`${x.parent}-${x.child}`} className="px-2 py-1 text-[12.5px] text-fg-dim" data-testid="denied-spawn">Declined: {nameOf(x.child)} ({x.detail ?? "not allowed"})</li>
            ))}
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

      {run.exam && <ExamPanel card={run.exam} />}
      {run.situation && <SituationPanel card={run.situation} />}

      {run.answer && <AnswerText text={run.answer} sources={run.sources} onOpen={() => openWorkspace("sources")} />}
      {running && !run.answer && <div className="h-4 w-36 animate-pulse rounded bg-surface-2" />}
      {run.status === "error" && <p role="alert" className="text-[13.5px] text-bad">{run.error}</p>}

      {!running && run.exam && (
        <div className="flex flex-wrap gap-2" data-testid="follow-ups">
          <button type="button" disabled={busy} onClick={() => void send("Explain the exam result above in two plain sentences, and say what to fix first.")} className={CHIP}>↳ Explain the seal</button>
          <button type="button" disabled={busy} onClick={() => void send(run.prompt)} className={CHIP}>↳ Run it again</button>
        </div>
      )}

      {(run.sources.length > 0 || pages > 0 || liveViewUrl || terms > 0) && (
        <div className="flex flex-wrap gap-2">
          {(run.sources.length > 0 || pages > 0) && (
            <button type="button" data-testid="sources-chip" onClick={() => openWorkspace("sources")} className={CHIP}>
              <SourceStack hosts={[...new Set([...run.sources.map((s) => s.host), ...grouped.hosts.map((h) => h.host)])]} />
              {Math.max(pages, run.sources.length)} sources{run.used.length > 0 && ` · ${run.used.length} cited`}
            </button>
          )}
          {liveViewUrl && <button type="button" onClick={() => openWorkspace("browser")} className={CHIP}><IconGlobe className="size-4" />Browser</button>}
          {terms > 0 && <button type="button" onClick={() => openWorkspace("terminal")} className={CHIP}><IconTerminal className="size-4" />{terms} command{terms === 1 ? "" : "s"}</button>}
        </div>
      )}
    </article>
  );
}
