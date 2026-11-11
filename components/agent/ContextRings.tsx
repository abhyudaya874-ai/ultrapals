"use client";
import { useMemo, useState } from "react";
import { Collapse } from "@/components/ui/Collapse";
import { HoverCard } from "@/components/ui/HoverCard";
import { IconChevronDown } from "@/components/ui/icons";
import { toolTotal, type AgentLoad } from "@/lib/usage/context";
import { doingLine, ringHeadline, ringSource, toolLine } from "@/lib/usage/describe";
import { ringsFor, type Ring } from "@/lib/usage/rings";
import { fillOf, formatTokens, percentLabel, percentOf, type Fill } from "@/lib/usage/tokens";
import { useAgent } from "./AgentProvider";

const R = 9;
const C = 2 * Math.PI * R;
const COLOUR: Record<Fill, string> = { calm: "var(--color-fg-muted)", warn: "var(--color-warn)", full: "var(--color-bad)" };

function Dial({ r }: { r: Ring }) {
  const pct = percentOf(r.used, r.window);
  const shown = r.used > 0 ? Math.max(pct, 4) : 0; // a little use still shows a sliver
  return (
    <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2.6" />
      <circle cx="12" cy="12" r={R} fill="none" stroke={COLOUR[fillOf(r.worst)]} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} opacity={r.started ? 1 : 0.55} style={{ transition: "stroke-dashoffset 200ms linear, stroke 160ms" }} />
    </svg>
  );
}

function Bar({ a }: { a: AgentLoad }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${a.used > 0 ? Math.max(a.pct, 2) : 0}%`, background: COLOUR[fillOf(a.pct)], transition: "width 200ms linear, background 160ms" }} />
    </div>
  );
}

/** One agent's line: who, how much, and a bar of its own window. A running agent has a pulsing dot. */
function Row({ a }: { a: AgentLoad }) {
  return (
    <li className="rise" data-testid="ring-agent" data-live={a.live}>
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className={`size-1.5 shrink-0 self-center rounded-full ${a.live || a.state === "running" ? "animate-pulse bg-warn" : "bg-ok/70"}`} />
        <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
        <span className="shrink-0 tabular-nums text-fg-muted">{formatTokens(a.used)}</span>
        <span className="w-9 shrink-0 text-right tabular-nums text-fg-dim">{percentLabel(a.used, a.window)}</span>
      </div>
      <Bar a={a} />
      {doingLine(a) && <p className="mt-1 truncate pl-3.5 text-[11.5px] text-fg-dim" data-testid="ring-doing">{doingLine(a)}</p>}
    </li>
  );
}

/** Everything one agent did, for the "show more" part: its model, its calls and tokens, and the work around them. */
function Detail({ a }: { a: AgentLoad }) {
  const tools = toolLine(a.tools);
  return (
    <li className="rise rounded-lg bg-white/[0.04] px-2.5 py-2 text-[12px] leading-snug" data-testid="ring-detail">
      <p className="flex items-baseline gap-2 text-fg"><span className="shrink-0">{a.name}</span><span className="min-w-0 flex-1 truncate text-right text-fg-dim">{a.model ? `${a.model.split("/").pop()} · ${a.provider}` : "no model"}</span></p>
      <p className="mt-0.5 text-fg-muted">
        {a.model ? (
          <>
            {a.calls > 0 ? `${a.calls} call${a.calls === 1 ? "" : "s"} · ${formatTokens(a.spent)} spent` : a.live ? "first call running" : "no finished call"}
            {" · "}now {formatTokens(a.prompt)} in, {formatTokens(a.completion)} out{a.exact ? "" : a.live ? " (streaming)" : " (estimated)"}
          </>
        ) : "no model call yet"}
      </p>
      <p className="mt-0.5 text-fg-dim">{tools || "no tool calls"}</p>
    </li>
  );
}

function Card({ r, more, setMore }: { r: Ring; more: boolean; setMore: (v: boolean) => void }) {
  const calls = r.agents.reduce((n, a) => n + toolTotal(a.tools), 0);
  return (
    <div className="space-y-2.5 text-[12.5px] leading-snug" data-testid="ring-card">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-fg">{ringHeadline(r)}</p>
        <p className="text-fg-muted">{r.label}{r.working > 0 ? ` · ${r.working} working` : ""}</p>
        <p className="text-fg-dim">{ringSource(r)}</p>
      </div>
      {r.agents.length > 0 && (
        <>
          <ul className="space-y-2" data-testid="ring-agents">{r.agents.map((a) => <Row key={a.id} a={a} />)}</ul>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} data-testid="ring-more" className="press flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-accent hover:bg-white/[0.05]">
            {more ? "Show less" : `Show all tool calls (${calls})`}
            <IconChevronDown className={`ml-auto size-3.5 transition-transform duration-200 ${more ? "rotate-180" : ""}`} />
          </button>
          <Collapse open={more}>
            <div className="space-y-2 pb-0.5">
              <ul className="space-y-1.5">{r.agents.map((a) => <Detail key={a.id} a={a} />)}</ul>
              <p className="px-1 text-fg-dim">Each bar is that agent&apos;s latest call against the smallest window among the models it has used, because its next call can land on that one. The ring turns amber from 70% and red from 90% of the fullest single agent.</p>
            </div>
          </Collapse>
        </>
      )}
      {r.draft > 0 && <p className="text-fg-dim">The message you are typing adds about {formatTokens(r.draft)}.</p>}
      {(r.calls > 0 || r.live) && <p className="text-fg-dim">{r.calls} finished call{r.calls === 1 ? "" : "s"}{r.live ? " (one running now)" : ""} · {formatTokens(r.tokens)} tokens spent in this run</p>}
    </div>
  );
}

/**
 * Context used, beside the send button, the way Kiro shows it: one ring for the whole team. A chat's ring adds up UltraPal and every Pal it sent out
 * (BrowserPal, TerminalPal, ResearchPal ...); a Battle has one per team and a Loop one per round, each adding up that team's agents. It moves while any of them
 * streams. Hover for the figures; "Show all tool calls" opens each agent's model, calls, tokens and the work it did, with a bar of its own window.
 */
export function ContextRings({ draft }: { draft: string }) {
  const { mode, runs, busy } = useAgent();
  const rings = useMemo(() => ringsFor({ mode, runs, draft, busy }), [mode, runs, draft, busy]);
  const [more, setMore] = useState(false);
  return (
    <span role="group" aria-label="Context used" className="inline-flex items-center" data-testid="context-rings" data-count={rings.length}>
      {rings.map((r) => (
        <HoverCard key={r.key} card={<Card r={r} more={more} setMore={setMore} />} width={340} maxHeight={560} side="top" label={`${r.label}: ${percentLabel(r.used, r.window)} of context used`}>
          <button type="button" data-testid="context-ring" data-pct={percentOf(r.used, r.window)} data-used={r.used} data-window={r.window} data-working={r.working} data-started={r.started} data-live={r.live} data-agents={r.agents.length} aria-label={`${r.label}: ${ringHeadline(r)}`} className="press relative grid size-6 place-items-center rounded-full hover:bg-surface-2/70 focus-visible:bg-surface-2/70 focus-visible:outline-none">
            <Dial r={r} />
            {r.working > 0 && <span aria-hidden="true" data-testid="ring-spin" className="pointer-events-none absolute inset-0 rounded-full border-2 border-transparent border-t-fg-muted/80 motion-safe:animate-spin" />}
          </button>
        </HoverCard>
      ))}
      {rings.length === 1 && rings[0].started && (
        <span className="ml-0.5 mr-1 min-w-[2.2rem] text-[11px] tabular-nums text-fg-dim" data-testid="ring-count" aria-hidden="true">{formatTokens(rings[0].used)}</span>
      )}
    </span>
  );
}
