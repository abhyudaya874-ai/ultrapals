"use client";
import { formatDuration } from "@/components/thread/format";
import { safeHttpUrl } from "@/components/thread/safe-url";
import { SiteAvatar } from "@/components/ui/SiteChip";
import { findRun, modelName, noModelsNote, reportFor, tally, type AgentReport } from "@/lib/computer/agent-report";
import { palName } from "@/lib/computer/pals";
import type { Run } from "@/lib/computer/run";
import { formatTokens } from "@/lib/usage/tokens";
import { useAgent } from "./AgentProvider";
import { FileChanges } from "./FileChanges";
import { Tail, Thought } from "./Thought";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const ACTION = "h-7 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
const EMPTY = "grid h-full place-items-center px-8 text-center text-[13.5px] text-fg-dim";

function Section({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h4 className="flex items-baseline gap-2 text-[11.5px] font-medium uppercase tracking-wide text-fg-dim">{title}{meta && <span className="normal-case tracking-normal">{meta}</span>}</h4>
      {children}
    </section>
  );
}

function Models({ r }: { r: AgentReport }) {
  if (r.models.length === 0) return <p className="text-[13px] text-fg-dim">{noModelsNote(r)}</p>;
  return (
    <ul className="space-y-1.5">
      {r.models.map((m) => (
        <li key={`${m.provider}:${m.model}`} className="flex flex-wrap items-baseline gap-x-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]" data-testid="model-row">
          <span className="font-medium text-fg">{modelName(m)}</span>
          <span className="text-fg-muted">{m.calls} call{m.calls === 1 ? "" : "s"}</span>
          <span className="tabular-nums text-fg-dim">{formatTokens(m.prompt)} in · {formatTokens(m.completion)} out{m.exact ? "" : " (estimated)"}</span>
        </li>
      ))}
      {r.thinking && <li className="px-1 text-[12.5px] text-fg-dim">A call is running now.</li>}
    </ul>
  );
}

function Commands({ r }: { r: AgentReport }) {
  return (
    <ul className="space-y-2">
      {r.commands.map((c) => (
        <li key={c.id} className="rounded-lg border border-line bg-black/25 font-mono text-[12.5px]" data-testid="command-row">
          <div className="flex items-start gap-2 px-3 py-2 text-fg">
            <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${DOT[c.state]}`} />
            <span className="text-accent">$</span>
            <span className="min-w-0 flex-1 break-all">{c.command}</span>
            <span className="shrink-0 text-fg-dim">{c.exit !== undefined ? `exit ${c.exit}` : c.state === "running" ? "running" : ""}{c.ms ? ` · ${formatDuration(c.ms)}` : ""}</span>
          </div>
          {c.out && <Tail text={c.out} className="max-h-56 border-t border-line px-3 py-2 text-[12px]" />}
        </li>
      ))}
    </ul>
  );
}

function Pages({ r }: { r: AgentReport }) {
  return (
    <div className="space-y-3">
      {r.searches.length > 0 && (
        <ul className="space-y-1">
          {r.searches.map((s) => (
            <li key={s.id} className="flex items-baseline gap-2 text-[13px]" data-testid="search-row">
              <span className="min-w-0 flex-1 truncate text-fg">“{s.label}”</span>
              <span className="shrink-0 text-fg-dim">{s.via ?? "search"}{s.count !== undefined ? ` · ${s.count} results` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {r.pageRows.length > 0 && (
        <ul className="space-y-0.5" data-testid="page-list">
          {r.pageRows.map((p) => {
            const href = safeHttpUrl(p.url);
            const body = (
              <>
                <SiteAvatar host={p.host} size={18} />
                <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
                <span className="hidden shrink-0 text-[12px] text-fg-dim sm:inline">{p.host}</span>
                {p.n !== null && <span className="shrink-0 rounded bg-surface-2 px-1.5 text-[11.5px] tabular-nums text-fg-muted" title="The number the answer cites this page by">[{p.n}]</span>}
              </>
            );
            const cls = "flex min-h-8 items-center gap-2 rounded-lg px-2 text-[13px]";
            return (
              <li key={p.url}>
                {href ? <a href={href.href} target="_blank" rel="noreferrer noopener" title={p.url} className={`${cls} hover:bg-surface-2`}>{body}</a> : <span className={cls} title={p.url}>{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One subagent's own panel: what it was asked, which models it used and how much, every command it ran, every file it touched, every search
 * and every page it read (all of them, not a count), its steps, and its own reasoning as it thinks. A section appears only when the agent did
 * that kind of work.
 */
export function AgentDetail({ run, id }: { run: Run | undefined; id: string }) {
  const { setPip, openTab, liveViewUrl } = useAgent();
  const r = run ? reportFor(run, id) : null;
  if (!run || !r) return <p className={EMPTY}>Pick an agent from the thread.</p>;
  const { agent } = r;
  const counts = tally(r);
  return (
    <div className="h-full space-y-5 overflow-y-auto p-4" data-testid="agent-detail">
      <header>
        <div className="flex items-center gap-2">
          <span className={`inline-block size-2.5 shrink-0 rounded-full ${DOT[agent.state]}`} />
          <h3 className="text-[15px] font-medium text-fg">{agent.title}</h3>
          <span className="text-[12px] text-fg-dim">{agent.state}{agent.ms !== undefined ? ` · ${formatDuration(agent.ms)}` : ""}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-fg-dim">{agent.id}{agent.parent ? ` · reports to ${palName(agent.parent)}` : ""}</p>
        {counts.length > 0 && <p className="mt-2 text-[13px] text-fg-muted" data-testid="agent-tally">{counts.join(" · ")}</p>}
        {(agent.role === "browser" && liveViewUrl) || r.commands.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {agent.role === "browser" && liveViewUrl && <button type="button" onClick={() => setPip({ open: true, expanded: true })} className={ACTION}>Show the live browser</button>}
            {r.commands.length > 0 && <button type="button" onClick={() => openTab("terminal")} className={ACTION}>Open the full terminal</button>}
          </div>
        ) : null}
      </header>

      {r.task && <Section title="Task" testId="agent-task"><p className="border-l-2 border-line pl-3 text-[13.5px] leading-relaxed text-fg">{r.task}</p></Section>}

      <Section title="Models" meta={r.calls > 0 ? `${formatTokens(r.tokensIn)} in · ${formatTokens(r.tokensOut)} out` : undefined} testId="agent-models"><Models r={r} /></Section>

      {r.commands.length > 0 && <Section title="Commands" meta={`${r.commands.length} run`} testId="agent-commands"><Commands r={r} /></Section>}

      {r.files.length > 0 && <Section title="Files" meta={`${r.files.length}`} testId="agent-files"><FileChanges files={r.files} live={agent.state === "running"} /></Section>}

      {(r.searches.length > 0 || r.pageRows.length > 0) && (
        <Section title="Sources" meta={`${r.searches.length} search${r.searches.length === 1 ? "" : "es"} · ${r.pages} page${r.pages === 1 ? "" : "s"} read`} testId="agent-sources"><Pages r={r} /></Section>
      )}

      {r.helpers.length > 0 && (
        <Section title="Helpers" testId="agent-helpers">
          <ul className="space-y-1">
            {r.helpers.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-[13px]"><span className={`inline-block size-2 shrink-0 rounded-full ${DOT[h.state]}`} /><span className="text-fg">{h.title}</span><span className="truncate text-fg-dim">{h.steps.at(-1)?.label ?? ""}</span></li>
            ))}
          </ul>
        </Section>
      )}

      {agent.steps.length > 0 && (
        <Section title="Steps" meta={`${r.steps.ok} done${r.steps.failed ? ` · ${r.steps.failed} failed` : ""}${r.steps.running ? ` · ${r.steps.running} running` : ""}`} testId="agent-steps">
          <ul className="space-y-1">
            {agent.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 text-[13.5px]">
                <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[s.state]}`} />
                <span className="truncate">{s.label}</span>
                {s.detail && <span className={`truncate ${s.state === "error" ? "text-bad" : "text-fg-dim"}`}>{s.detail}</span>}
                <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{s.ms !== undefined ? formatDuration(s.ms) : ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.result && <Section title="Handed back" testId="agent-result"><p className="text-[13.5px] leading-relaxed text-fg">{r.result}</p></Section>}

      {agent.reasoning && (
        <Section title="Reasoning" meta={`${r.thoughtChars} characters`} testId="agent-reasoning">
          <Thought text={agent.reasoning} className="max-h-80 border-l border-line pl-3 text-[12.5px]" />
        </Section>
      )}
    </div>
  );
}
