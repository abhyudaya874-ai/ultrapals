"use client";
import { useMemo } from "react";
import { HoverCard } from "@/components/ui/HoverCard";
import { ringsFor, type Ring } from "@/lib/usage/rings";
import { fillOf, formatTokens, percentLabel, percentOf } from "@/lib/usage/tokens";
import { useAgent } from "./AgentProvider";

const R = 9;
const C = 2 * Math.PI * R;
const STROKE: Record<ReturnType<typeof fillOf>, string> = { calm: "var(--color-fg-muted)", warn: "var(--color-warn)", full: "var(--color-bad)" };

/** Pure. What the tooltip says first, in the words Devin uses: "36% (362K / 1M) context used". An estimate is marked with "about". */
export function ringHeadline(r: Ring): string {
  const about = r.started && r.exact ? "" : "about ";
  return `${about}${percentLabel(r.used, r.window)} (${formatTokens(r.used)} / ${formatTokens(r.window)}) context used`;
}

/** Pure. Where the numbers came from, in a sentence a person can check. */
export function ringSource(r: Ring): string {
  if (!r.started) return "Nothing has been sent yet. This is UltraPal's own instructions, against the smallest window among the models it can use.";
  const n = `${formatTokens(r.prompt)} in, ${formatTokens(r.completion)} out`;
  return r.exact ? `Counted by the provider: ${n}.` : `Estimated from the text: about ${n}. This provider sent no count.`;
}

function Dial({ r }: { r: Ring }) {
  const pct = percentOf(r.used, r.window);
  const shown = r.used > 0 ? Math.max(pct, 4) : 0; // a little use still shows a sliver
  return (
    <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2.6" />
      <circle cx="12" cy="12" r={R} fill="none" stroke={STROKE[fillOf(pct)]} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} opacity={r.started ? 1 : 0.55} style={{ transition: "stroke-dashoffset 260ms cubic-bezier(0.2, 0.8, 0.2, 1), stroke 160ms" }} />
    </svg>
  );
}

function Card({ r }: { r: Ring }) {
  return (
    <div className="space-y-1 text-[12.5px] leading-snug" data-testid="ring-card">
      <p className="text-[13px] font-medium text-fg">{ringHeadline(r)}</p>
      <p className="text-fg-muted">{r.label}{r.model ? ` · ${r.model.split("/").pop()} (${r.provider})` : ""}</p>
      <p className="text-fg-dim">{ringSource(r)}</p>
      {r.draft > 0 && <p className="text-fg-dim">The message you are typing adds about {formatTokens(r.draft)}.</p>}
      {r.calls > 0 && <p className="text-fg-dim">{r.calls} call{r.calls === 1 ? "" : "s"} by this agent · {formatTokens(r.tokens)} tokens spent in this run</p>}
    </div>
  );
}

/**
 * Context used, beside the send button, as in Devin: a ring that fills as the model's window does. A chat has one (UltraPal's latest call); a Battle
 * has one per team and a Loop one per round, each with that agent's own numbers. Hover for the figures and where they came from.
 */
export function ContextRings({ draft }: { draft: string }) {
  const { mode, runs, busy } = useAgent();
  const rings = useMemo(() => ringsFor({ mode, runs, draft, busy }), [mode, runs, draft, busy]);
  return (
    <span role="group" aria-label="Context used" className="inline-flex items-center" data-testid="context-rings" data-count={rings.length}>
      {rings.map((r) => (
        <HoverCard key={r.key} card={<Card r={r} />} width={300} side="top" label={`${r.label}: ${percentLabel(r.used, r.window)} of context used`}>
          <button type="button" data-testid="context-ring" data-pct={percentOf(r.used, r.window)} data-started={r.started} aria-label={`${r.label}: ${ringHeadline(r)}`} className="press grid size-6 place-items-center rounded-full hover:bg-surface-2/70 focus-visible:bg-surface-2/70 focus-visible:outline-none">
            <Dial r={r} />
          </button>
        </HoverCard>
      ))}
    </span>
  );
}
