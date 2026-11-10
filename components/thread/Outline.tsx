"use client";
import { useEffect, useRef, useState } from "react";
import { IconDownload, IconFile } from "@/components/ui/icons";
import { formatDuration } from "./format";
import type { StepGroup } from "./group-trace";
import { useDismiss } from "./Dock";
import { hostLabel, safeHttpUrl, type TraceSource } from "./safe-url";

interface Cap { id: string; on: boolean; note: string }

export interface OutlineProps {
  groups: StepGroup[];
  sources: TraceSource[];
  approveUrl: string | null;
  hasVerdict: boolean;
  hasDiff: boolean;
  hasLog: boolean;
  onPickAgent: (id: string) => void;
  onPickArtifact: (which: "verdict" | "source" | "log") => void;
  onClose: () => void;
}

const row = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
const h2 = "px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-fg-dim";

export function Outline(p: OutlineProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, p.onClose, ref);
  const [caps, setCaps] = useState<Cap[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Cap[]) => live && setCaps(Array.isArray(d) ? d : []))
      .catch(() => live && setCaps([]));
    return () => { live = false; };
  }, []);

  const agents = p.groups.filter((g) => g.agent !== null);
  const approve = p.approveUrl ? safeHttpUrl(p.approveUrl) : null;
  const allSources: TraceSource[] = [
    ...(approve ? [{ url: approve, host: hostLabel(approve) }] : []),
    ...p.sources,
  ];
  const artifacts: { which: "verdict" | "source" | "log"; label: string }[] = [
    ...(p.hasVerdict ? [{ which: "verdict" as const, label: "Verdict brief" }] : []),
    ...(p.hasDiff ? [{ which: "source" as const, label: "decide() source" }] : []),
    ...(p.hasLog ? [{ which: "log" as const, label: "Event log" }] : []),
  ];

  return (
    <div ref={ref} data-testid="outline" className="pop-in-down absolute right-3 top-14 z-30 flex max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {agents.length > 0 && (
          <>
            <h2 className={h2}>Agents</h2>
            <ul>
              {agents.map((g) => (
                <li key={g.id}>
                  <button type="button" className={row} onClick={() => { p.onPickAgent(g.id); p.onClose(); }}>
                    <span className={`size-2 shrink-0 rounded-full ${g.state === "error" ? "bg-bad" : g.state === "running" ? "animate-pulse bg-warn" : g.state === "ok" ? "bg-ok" : "bg-fg-dim"}`} />
                    <span className="min-w-0 flex-1 truncate">{g.title}</span>
                    <span className="shrink-0 tabular-nums text-fg-dim">{g.ms !== undefined ? formatDuration(g.ms) : g.state}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {artifacts.length > 0 && (
          <>
            <h2 className={h2}>Artifacts</h2>
            <ul>
              {artifacts.map((a) => (
                <li key={a.which}>
                  <button type="button" className={row} onClick={() => { p.onPickArtifact(a.which); p.onClose(); }}>
                    <IconDownload className="size-4 shrink-0 text-fg-dim" />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    <IconFile className="size-3.5 shrink-0 text-fg-dim" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {caps && caps.length > 0 && (
          <>
            <h2 className={h2}>Plugins</h2>
            <ul>
              {caps.map((c) => (
                <li key={c.id} title={c.note}>
                  <div className={`${row} cursor-default`}>
                    <span className={`size-2 shrink-0 rounded-full ${c.on ? "bg-ok" : "bg-fg-dim"}`} />
                    <span className="min-w-0 flex-1 truncate">{c.id}</span>
                    <span className="shrink-0 text-fg-dim">{c.on ? "on" : "off"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {allSources.length > 0 && (
          <>
            <h2 className={h2}>Sources</h2>
            <ul>
              {allSources.map((s) => (
                <li key={s.url.href}>
                  <a href={s.url.href} target="_blank" rel="noreferrer noopener" className={row}>
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px] font-medium uppercase text-fg-muted">{s.host[0]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg">{s.host}</span>
                      <span className="block truncate text-[12px] text-fg-dim">{s.url.pathname}{s.url.search}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
