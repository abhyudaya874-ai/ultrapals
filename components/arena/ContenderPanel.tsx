"use client";
import { useMemo, useState } from "react";
import { AnswerText } from "@/components/agent/AnswerText";
import { SearchedSites } from "@/components/agent/SearchedSites";
import { BattleOrb } from "@/components/orbs/Orbs";
import { safeHttpUrl } from "@/components/thread/safe-url";
import { IconFile, IconGlobe, IconMaximize, IconSearch, IconTerminal } from "@/components/ui/icons";
import { liveViewSrc } from "@/lib/browse/live-view";
import { familyOf } from "@/lib/pals/family";
import { subagents, type AgentRow, type ContenderState } from "@/lib/computer/run";
import { statusText } from "@/lib/arena/view";
import type { PanelHooks } from "./PanelBoard";

type Tab = "activity" | "terminal" | "browser" | "report";
const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;

const ROLE_ICON = (role: string) => (role === "browser" ? <IconGlobe className="size-3.5" /> : role === "terminal" ? <IconTerminal className="size-3.5" /> : <IconSearch className="size-3.5" />);

function last(a: AgentRow): string {
  const s = [...a.steps].reverse().find((x) => x.state !== "running") ?? a.steps.at(-1);
  if (s) return s.label;
  const cmd = a.terms.at(-1);
  if (cmd) return `ran ${cmd.command.length > 40 ? `${cmd.command.slice(0, 39)}…` : cmd.command}`;
  const f = a.files.at(-1);
  return f ? `wrote ${f.path.split("/").pop()}` : "Starting…";
}

function Activity({ c }: { c: ContenderState }) {
  const subs = subagents(c.run);
  const files = subs.flatMap((a) => a.files).filter((f) => f.mode !== "read");
  if (subs.length === 0 && c.run.visits.length === 0) return <p className="text-[12.5px] text-fg-dim">{c.state === "pending" ? "Starts when a place opens up." : "Getting started…"}</p>;
  return (
    <ul className="space-y-1.5">
      {subs.map((a) => (
        <li key={a.id} className="rise flex items-center gap-2 text-[12.5px]">
          <span className="text-fg-muted">{ROLE_ICON(a.role)}</span>
          <span className="shrink-0 text-fg">{a.title}</span>
          <span className="min-w-0 flex-1 truncate text-fg-dim">{last(a)}</span>
          <span className={`size-1.5 shrink-0 rounded-full ${DOT[a.state]}`} />
        </li>
      ))}
      <SearchedSites visits={c.run.visits} running={c.state === "running"} collapsed />
      {files.map((f) => (
        <li key={f.id} className="rise flex items-center gap-2 text-[12.5px] text-fg-muted">
          <IconFile className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path.replace(/^\/workspace\//, "")}</span>
          <span className="shrink-0 tabular-nums text-[11.5px]"><span className="text-ok">+{f.adds}</span> <span className="text-bad">−{f.removes}</span></span>
        </li>
      ))}
    </ul>
  );
}

function Terminal({ c }: { c: ContenderState }) {
  const blocks = subagents(c.run).flatMap((a) => a.terms).slice(-4);
  if (blocks.length === 0) return <p className="text-[12.5px] text-fg-dim">No commands yet.</p>;
  return (
    <ul className="space-y-3">
      {blocks.map((b) => (
        <li key={b.id} className="rise">
          <p className="truncate font-mono text-[12px] text-fg"><span className="text-fg-dim">$ </span>{b.command}</p>
          {b.out && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-fg-muted">{b.out.split("\n").slice(-14).join("\n")}</pre>}
        </li>
      ))}
    </ul>
  );
}

function Report({ c }: { c: ContenderState }) {
  const o = c.outcome;
  const open = (n: number) => { const u = safeHttpUrl(c.run.sources[n - 1]?.url); if (u) window.open(u.href, "_blank", "noopener,noreferrer"); };
  return (
    <div className="space-y-4">
      {o && (
        <dl className="space-y-2 text-[13px]">
          <div><dt className="text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">Prediction · {Math.round(o.confidence * 100)}% sure</dt><dd className="mt-0.5 text-fg">{o.prediction}</dd></div>
          {o.risks.length > 0 && <div><dt className="text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">Risks</dt><dd className="mt-0.5 text-fg-muted">{o.risks.join(" · ")}</dd></div>}
        </dl>
      )}
      {c.run.answer ? <div className="text-[0.8em]"><AnswerText text={c.run.answer} sources={c.run.sources} onOpen={open} /></div> : <p className="text-[12.5px] text-fg-dim">The report appears here as it is written.</p>}
    </div>
  );
}

/**
 * One team's live view: who it is and what it was told to defend, then four tabs for what it is doing. The browser tab shows its own live
 * browser while it has one. Plain type, hairlines, no colour except the state dot.
 */
export function ContenderPanel({ c, hooks, winner = false, judging = false, bare = false }: { c: ContenderState; hooks?: PanelHooks; winner?: boolean; judging?: boolean; bare?: boolean }) {
  const [picked, setPicked] = useState<Tab | null>(null);
  const done = c.state === "ok" || c.state === "error";
  const tab: Tab = picked ?? (done ? "report" : "activity");
  const terms = subagents(c.run).reduce((n, a) => n + a.terms.length, 0);
  const src = useMemo(() => liveViewSrc(c.run.liveViewUrl, true), [c.run.liveViewUrl]);
  const tabs: { id: Tab; label: string; n?: number }[] = [{ id: "activity", label: "Activity" }, { id: "terminal", label: "Terminal", n: terms }, ...(src ? [{ id: "browser" as const, label: "Browser" }] : []), { id: "report", label: "Report" }];
  const family = c.info.model ? familyOf(c.info.model) : null;
  return (
    <section className="flex size-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface" data-testid="contender-panel" data-state={c.state} aria-label={c.info.name}>
      {!bare && (
        <>
          <header className={`flex items-center gap-2.5 border-b border-line px-3 py-2.5 ${hooks ? "cursor-grab active:cursor-grabbing" : ""}`} {...(hooks?.grab ?? {})}>
            <BattleOrb id={c.info.id} size={30} state={c.state} tool={c.info.tool} judging={judging} winner={winner} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[13.5px] font-medium text-fg">{c.info.name}</h3>
              <p className="truncate text-[12px] text-fg-dim" aria-live="polite">{statusText(c)}</p>
            </div>
            {hooks && <button type="button" onClick={hooks.toggleFocus} aria-label={hooks.focused ? "Show all panels" : `Focus ${c.info.name}`} title={hooks.focused ? "Show all panels" : "Focus this panel"} className="press grid size-7 shrink-0 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"><IconMaximize className="size-3.5" /></button>}
          </header>
          <p className="truncate px-3 pt-2 text-[12px] text-fg-muted">
            {c.info.round ? c.info.scenarioName ?? c.info.name : <>Defends: <span className="text-fg">{c.info.stance}</span></>}
            {family && <span className="text-fg-dim"> · {family}</span>}
          </p>
        </>
      )}
      <nav className={`flex gap-4 px-3 ${bare ? "pt-3" : "pt-2"}`} role="tablist" aria-label={`${c.info.name} views`}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setPicked(t.id)}
            className={`press relative pb-1.5 text-[12.5px] transition-colors ${tab === t.id ? "text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-fg" : "text-fg-dim hover:text-fg-muted"}`}>
            {t.label}{t.n ? <span className="ml-1 tabular-nums text-fg-dim">{t.n}</span> : null}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-3" role="tabpanel">
        {tab === "activity" && <Activity c={c} />}
        {tab === "terminal" && <Terminal c={c} />}
        {tab === "browser" && src && <div className="aspect-[16/10] overflow-hidden rounded-lg bg-black"><iframe src={src} title={`${c.info.name} browser`} allow="autoplay" className="pointer-events-none size-full" /></div>}
        {tab === "report" && <Report c={c} />}
      </div>
    </section>
  );
}
