"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/components/thread/format";
import { useDismiss } from "@/components/thread/Dock";
import { IconBoard, IconClock, IconFile, IconGlobe, IconPlus, IconTerminal, IconX, IconAgent, IconBolt, IconSearch } from "@/components/ui/icons";
import { SiteChip } from "@/components/ui/SiteChip";
import { subagents, type AgentRow } from "@/lib/computer/run";
import { groupVisits } from "@/lib/computer/visits";
import type { Source } from "@/lib/research/sources";
import { Rail, ResizeHandle, useResizable } from "@/components/shell/Resizable";
import { useAgent } from "./AgentProvider";
import { ChartBlock } from "./ChartBlock";
import { FileArtifact } from "./FileArtifact";
import { SourcePane } from "./SourcePane";
import { APP_ARTIFACTS, appTab, baseName, collectFiles, parseTab, type AppArtifactName } from "./panel-model";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const EMPTY = "grid h-full place-items-center px-8 text-center text-[13.5px] text-fg-dim";

function BrowserTab() {
  const { pip, setPip, liveViewUrl } = useAgent();
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div>
        <p className="text-[13.5px] text-fg-dim">The live browser plays in the corner of the screen so you can watch it while you read.</p>
        <button type="button" disabled={!liveViewUrl} onClick={() => setPip({ open: true, expanded: !pip.expanded || !pip.open })} className="mt-3 h-8 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">{liveViewUrl ? "Show the browser" : "No browser yet"}</button>
      </div>
    </div>
  );
}

function TerminalTab({ agents }: { agents: AgentRow[] }) {
  const blocks = agents.flatMap((a) => a.terms.map((t) => ({ ...t, agent: a.title })));
  const end = useRef<HTMLDivElement>(null);
  const tailLen = blocks.at(-1)?.out.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [blocks.length, tailLen]);
  if (!blocks.length) return <p className={EMPTY}>No commands yet. Ask the agent to create a project or run something.</p>;
  return (
    <div className="h-full overflow-y-auto bg-black/30 p-3 font-mono text-[12.5px]" data-testid="terminal">
      {blocks.map((b) => (
        <div key={b.id} className="mb-3">
          <div className="flex items-center gap-2 text-fg">
            <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[b.state]}`} />
            <span className="text-accent">$</span>
            <span className="min-w-0 break-all">{b.command}</span>
            <span className="ml-auto shrink-0 text-fg-dim">{b.exit !== undefined ? `exit ${b.exit}` : ""}{b.ms ? ` · ${formatDuration(b.ms)}` : ""}</span>
          </div>
          {b.out && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all pl-4 text-fg-muted">{b.out}</pre>}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

function AgentTab({ agent, result }: { agent: AgentRow | undefined; result?: string }) {
  if (!agent) return <p className={EMPTY}>Pick an agent from the thread.</p>;
  return (
    <div className="h-full overflow-y-auto p-4">
      <h3 className="text-[15px] font-medium text-fg">{agent.title}</h3>
      <p className="text-[12px] text-fg-dim">{agent.id} · {agent.state}{agent.ms !== undefined ? ` · ${formatDuration(agent.ms)}` : ""}</p>
      {result && <p className="mt-3 text-[13.5px] leading-relaxed text-fg" data-testid="agent-result">{result}</p>}
      <ul className="mt-3 space-y-1">
        {agent.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2.5 text-[13.5px]">
            <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[s.state]}`} />
            <span className="truncate">{s.label}</span>
            {s.detail && <span className={`truncate ${s.state === "error" ? "text-bad" : "text-fg-dim"}`}>{s.detail}</span>}
            <span className="ml-auto shrink-0 tabular-nums text-fg-dim">{s.ms !== undefined ? formatDuration(s.ms) : ""}</span>
          </li>
        ))}
      </ul>
      {agent.reasoning && <p className="mt-4 whitespace-pre-wrap border-l border-line pl-3 text-[12.5px] italic leading-relaxed text-fg-dim">{agent.reasoning}</p>}
    </div>
  );
}


function SourcesTab({ sources, visited, active, setActive, close }: {
  sources: Source[];
  visited: ReturnType<typeof groupVisits>;
  active: number | null;
  setActive: (n: number | null) => void;
  close: () => void;
}) {
  const list = sources;
  if (list.length === 0 && visited.pages === 0) return <p className={EMPTY}>No sources yet.</p>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {list.length > 0 && <div className="min-h-[16rem] flex-1"><SourcePane sources={list} active={active} onPick={setActive} onClose={close} /></div>}
      {visited.pages > 0 && (
        <section className="space-y-2 rounded-card border border-line bg-surface p-3" data-testid="visited">
          <h3 className="text-[13.5px] font-medium text-fg">{visited.searches.length} searches · {visited.pages} websites read</h3>
          {visited.searches.map((s) => <p key={s.id} className="truncate text-[12.5px] text-fg-dim">🔍 {s.label}{s.count !== undefined ? ` · ${s.count} results` : ""}</p>)}
          {visited.hosts.map((h) => (
            <div key={h.host} className="space-y-1">
              <p className="text-[12px] text-fg-dim">{h.host}</p>
              <div className="flex flex-wrap gap-1.5">{h.pages.map((p) => <SiteChip key={p.id} url={p.url!} title={p.title} />)}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const Loading = () => <div className="m-3 h-64 animate-pulse rounded-card bg-surface-2" />;
const NewsroomArtifact = dynamic(() => import("./AppArtifacts").then((m) => m.NewsroomArtifact), { loading: Loading });
const DashboardArtifact = dynamic(() => import("./AppArtifacts").then((m) => m.DashboardArtifact), { ssr: false, loading: Loading });
const TimelineArtifact = dynamic(() => import("./AppArtifacts").then((m) => m.TimelineArtifact), { ssr: false, loading: Loading });
const ProctorArtifact = dynamic(() => import("./AppArtifacts").then((m) => m.ProctorArtifact), { loading: Loading });

const APP_ICON: Record<AppArtifactName, typeof IconFile> = { newsroom: IconGlobe, dashboard: IconBoard, timeline: IconClock, proctor: IconBolt };

/**
 * The right-hand panel: one tab per artifact (a file, the live browser, the terminal, the sources, a subagent, or one of the app's own
 * screens). Docked beside the chat on the home screen; over the page elsewhere.
 */
export function ArtifactPanel({ docked }: { docked: boolean }) {
  const { panel, openTab, closeTab, closePanel, openApp, runs, localFiles, reorderTabs } = useAgent();
  const size = useResizable("artifacts", "right");
  const [dragId, setDragId] = useState<string | null>(null);
  const agents = useMemo(() => runs.flatMap(subagents), [runs]);
  const files = useMemo(() => collectFiles(runs), [runs]);
  const charts = useMemo(() => runs.flatMap((r) => r.charts ?? []), [runs]);
  const sources = useMemo(() => [...runs].reverse().find((r) => r.sources.length)?.sources ?? [], [runs]);
  const visited = useMemo(() => groupVisits([...runs].reverse().find((r) => r.visits.length)?.visits ?? []), [runs]);
  const [pick, setPick] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menu, () => setMenu(false), menuRef);
  useEffect(() => {
    if (!panel.open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) closePanel(); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [panel.open, closePanel]);
  if (!panel.open) return null;

  const label = (id: string): { text: string; Icon: typeof IconFile } | null => {
    const t = parseTab(id);
    if (!t) return null;
    switch (t.kind) {
      case "browser": return { text: "Browser", Icon: IconGlobe };
      case "terminal": return { text: "Terminal", Icon: IconTerminal };
      case "sources": return { text: `Sources ${Math.max(sources.length, visited.pages) || ""}`.trim(), Icon: IconSearch };
      case "file": return { text: baseName(t.path), Icon: IconFile };
      case "app": return { text: APP_ARTIFACTS[t.name].title, Icon: APP_ICON[t.name] };
      case "agent": return { text: agents.find((a) => a.id === t.id)?.title ?? t.id, Icon: IconAgent };
      case "chart": return { text: charts.find((c) => c.id === t.id)?.spec.title ?? "Chart", Icon: IconBoard };
    }
  };
  const tabs = panel.tabs.flatMap((id) => { const l = label(id); return l ? [{ id, ...l }] : []; });
  const active = parseTab(panel.active ?? "");
  const shell = docked ? `fixed inset-0 z-[55] flex flex-col bg-canvas lg:static lg:z-auto lg:w-[var(--panel-w)] lg:shrink-0 ${size.dragging ? "" : "lg:transition-[width] lg:duration-[160ms] lg:ease-[cubic-bezier(0.2,0.8,0.2,1)]"} ${size.collapsed ? "lg:hidden" : ""}` : "fixed inset-0 z-[55] flex flex-col bg-canvas lg:absolute lg:z-30";

  return (
    <>
    {docked && <ResizeHandle r={size} label="artifacts" side="right" />}
    {docked && size.collapsed && <Rail title="Artifacts" badge={tabs.length} side="right" onOpen={() => size.setCollapsed(false)} />}
    <aside className={shell} style={docked ? size.style : undefined} data-testid="workspace" aria-label="Artifacts">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Artifacts">
          {tabs.map((t) => {
            const on = t.id === panel.active;
            return (
              <span
                key={t.id}
                draggable
                onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
                onDragOver={(e) => { if (dragId && dragId !== t.id) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragId) reorderTabs(dragId, panel.tabs.indexOf(t.id)); setDragId(null); }}
                onDragEnd={() => setDragId(null)}
                className={`group inline-flex h-8 shrink-0 items-center rounded-lg transition-colors ${dragId === t.id ? "opacity-40" : ""} ${on ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"}`}
              >
                <button type="button" role="tab" aria-selected={on} data-testid="artifact-tab" onClick={() => openTab(t.id)} className="inline-flex h-8 max-w-[11rem] items-center gap-1.5 pl-2.5 pr-1 text-[13px]">
                  <t.Icon className="size-4 shrink-0" /><span className="truncate">{t.text}</span>
                </button>
                <button type="button" onClick={() => closeTab(t.id)} aria-label={`Close ${t.text}`} className="mr-1 grid size-5 place-items-center rounded text-fg-dim hover:bg-line hover:text-fg"><IconX className="size-3" /></button>
              </span>
            );
          })}
          <div className="relative shrink-0" ref={menuRef}>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Open an artifact" aria-expanded={menu} title="Open an app artifact" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconPlus className="size-4" /></button>
            {menu && (
              <ul className="pop-in-down absolute left-0 top-9 z-10 w-64 rounded-card border border-line bg-surface p-1 shadow-xl" role="menu">
                {(Object.keys(APP_ARTIFACTS) as AppArtifactName[]).map((n) => {
                  const I = APP_ICON[n];
                  return (
                    <li key={n} role="none">
                      <button type="button" role="menuitem" onClick={() => { openApp(n); setMenu(false); }} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                        <I className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                        <span><span className="block text-[13.5px] text-fg">{APP_ARTIFACTS[n].title}</span><span className="block text-[12px] leading-snug text-fg-dim">{APP_ARTIFACTS[n].blurb}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <button type="button" onClick={closePanel} aria-label="Close panel" title="Close panel (Esc)" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconX className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {!active && <p className={EMPTY}>Nothing open. Files, the browser and the terminal appear here as the agents use them.</p>}
        {active?.kind === "browser" && <BrowserTab />}
        {active?.kind === "terminal" && <TerminalTab agents={agents} />}
        {active?.kind === "sources" && <SourcesTab sources={sources} visited={visited} active={pick} setActive={setPick} close={() => closeTab("sources")} />}
        {active?.kind === "file" && (() => {
          const e = files.find((f) => f.path === active.path);
          const content = e?.content ?? localFiles[active.path];
          return content === undefined ? <p className={EMPTY}>This file is no longer available.</p> : <FileArtifact key={active.path} path={active.path} content={content} write={e?.write} read={e?.read} />;
        })()}
        {active?.kind === "app" && active.name === "newsroom" && <NewsroomArtifact />}
        {active?.kind === "app" && active.name === "dashboard" && <DashboardArtifact />}
        {active?.kind === "app" && active.name === "timeline" && <TimelineArtifact />}
        {active?.kind === "app" && active.name === "proctor" && <ProctorArtifact />}
        {active?.kind === "chart" && (() => {
          const c = charts.find((x) => x.id === active.id);
          return c ? <div className="h-full overflow-y-auto p-4"><ChartBlock item={c} height={380} inPanel /></div> : <p className={EMPTY}>This chart is no longer available.</p>;
        })()}
        {active?.kind === "agent" && <AgentTab agent={agents.find((a) => a.id === active.id)} result={runs.flatMap((r) => r.messages).filter((m) => m.from === active.id).at(-1)?.text} />}
      </div>
    </aside>
    </>
  );
}
