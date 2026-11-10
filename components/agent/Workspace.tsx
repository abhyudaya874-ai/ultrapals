"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/components/thread/format";
import { IconFile, IconGlobe, IconTerminal, IconX } from "@/components/ui/icons";
import { liveViewSrc } from "@/lib/browse/live-view";
import { parseCsv } from "@/lib/computer/artifacts";
import { groupVisits } from "@/lib/computer/visits";
import { SiteChip } from "@/components/ui/SiteChip";
import { subagents, type AgentRow } from "@/lib/computer/run";
import { useAgent, type WorkspaceTab } from "./AgentProvider";
import { SourcePane } from "./SourcePane";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
const EMPTY = "grid h-full place-items-center px-8 text-center text-[13.5px] text-fg-dim";

function BrowserTab() {
  const { liveViewUrl, page, busy } = useAgent();
  const frame = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => liveViewSrc(liveViewUrl, true), [liveViewUrl]);
  const [playing, setPlaying] = useState(false);
  const [control, setControl] = useState(false);
  useEffect(() => {
    setPlaying(false);
    setControl(false);
    if (!src) return;
    const origin = new URL(src).origin;
    const on = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      if (e.data?.type === "KERNEL_PLAYING") setPlaying(true);
      if (e.data?.type === "KERNEL_PAUSED") setPlaying(false);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [src]);
  if (!src) return <p className={EMPTY}>The browser starts when an agent needs one. Ask it to open a page or build something.</p>;
  const toggle = () => {
    const next = !control;
    setControl(next);
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: !next, requestId: crypto.randomUUID() }, new URL(src).origin);
    if (next) frame.current?.focus();
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-fg-muted">
          <IconGlobe className="size-4 shrink-0" />
          <span className="truncate" data-testid="url-bar">{page?.url ?? "about:blank"}</span>
        </div>
        <button type="button" onClick={toggle} aria-pressed={control} className="h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg">
          {control ? "Give back control" : "Take over"}
        </button>
      </div>
      <div className="relative grid min-h-0 flex-1 place-items-center">
        <div className="relative aspect-[16/10] max-h-full w-full overflow-hidden rounded-card border border-line bg-black">
          <iframe ref={frame} src={src} title="Live browser" allow="autoplay; clipboard-read; clipboard-write" className="size-full" data-testid="live-view" />
          {!playing && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70 text-[13px] text-fg-muted">Connecting to the live browser…</div>}
        </div>
      </div>
      <p className="px-1 text-[12px] text-fg-dim">{control ? "You are controlling the browser." : busy ? "The agent is driving. Its cursor is the real one." : "Watching live. Use Take over to click yourself."}</p>
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

function FilesTab({ agents }: { agents: AgentRow[] }) {
  const files = agents.flatMap((a) => a.files);
  const [open, setOpen] = useState<string | null>(null);
  if (!files.length) return <p className={EMPTY}>No files yet.</p>;
  return (
    <ul className="h-full space-y-2 overflow-y-auto p-3" data-testid="files">
      {files.map((f) => (
        <li key={f.id} className="rounded-card bg-surface">
          <button type="button" onClick={() => setOpen(open === f.id ? null : f.id)} className="flex w-full items-center gap-3 p-3 text-left">
            <IconFile className="size-4 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{f.path.replace("/workspace/", "")}</span>
            <span className="text-[12px] text-fg-dim">{f.created ? "created" : "edited"}</span>
            <span className="text-[12px]"><span className="text-ok">+{f.adds}</span> <span className="text-bad">-{f.removes}</span></span>
          </button>
          {open === f.id && (f.path.endsWith(".csv") ? (
            <div className="max-h-80 overflow-auto border-t border-line p-2" data-testid="csv-preview">
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {parseCsv(f.preview, 30).map((r, i) => (
                    <tr key={i} className={i === 0 ? "text-fg" : "text-fg-muted"}>
                      {r.map((c, j) => <td key={j} className={`max-w-[16rem] truncate border border-line px-2 py-1 ${i === 0 ? "font-medium" : ""}`} title={c}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <pre className="max-h-80 overflow-auto border-t border-line p-3 font-mono text-[12px] leading-relaxed text-fg-muted">{f.preview}</pre>)}
        </li>
      ))}
    </ul>
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

const TABS: { id: WorkspaceTab; label: string; Icon: typeof IconFile }[] = [
  { id: "browser", label: "Browser", Icon: IconGlobe },
  { id: "terminal", label: "Terminal", Icon: IconTerminal },
  { id: "files", label: "Files", Icon: IconFile },
];

/** The big pane over the page: live browser, terminal, files, sources, or one agent's detail. */
export function Workspace() {
  const { workspace, closeWorkspace, openWorkspace, runs } = useAgent();
  const agents = useMemo(() => runs.flatMap(subagents), [runs]);
  const sources = useMemo(() => [...runs].reverse().find((r) => r.sources.length)?.sources ?? [], [runs]);
  const visited = useMemo(() => groupVisits([...runs].reverse().find((r) => r.visits.length)?.visits ?? []), [runs]);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!workspace.open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) closeWorkspace(); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [workspace.open, closeWorkspace]);
  if (!workspace.open) return null;
  const tab = workspace.tab;
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-canvas lg:absolute lg:z-30" data-testid="workspace">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => openWorkspace(id)} aria-pressed={tab === id}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ${tab === id ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
            <Icon className="size-4" />{label}
          </button>
        ))}
        {(sources.length > 0 || visited.pages > 0) && <button type="button" onClick={() => openWorkspace("sources")} aria-pressed={tab === "sources"} className={`inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] ${tab === "sources" ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>Sources {Math.max(sources.length, visited.pages)}</button>}
        {tab === "agent" && <span className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg">Agent</span>}
        <button type="button" onClick={closeWorkspace} aria-label="Close workspace" title="Close workspace" className="ml-auto grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <IconX className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "browser" && <BrowserTab />}
        {tab === "terminal" && <TerminalTab agents={agents} />}
        {tab === "files" && <FilesTab agents={agents} />}
        {tab === "sources" && (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
            {sources.length > 0 && <div className="min-h-[16rem] flex-1"><SourcePane sources={sources} active={active} onPick={setActive} onClose={closeWorkspace} /></div>}
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
        )}
        {tab === "agent" && <AgentTab agent={agents.find((a) => a.id === workspace.agentId)} result={runs.flatMap((r) => r.messages).filter((m) => m.from === workspace.agentId).at(-1)?.text} />}
      </div>
    </div>
  );
}
