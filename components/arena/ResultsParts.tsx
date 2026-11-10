"use client";
import type { ReactNode } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { CiteCard } from "@/components/agent/CiteCard";
import { fileTab } from "@/components/agent/panel-model";
import { Heatmap, RadarChart, SERIES } from "@/components/charts/Charts";
import { FlatOrb } from "@/components/orbs/Orbs";
import { lookFor } from "@/components/orbs/palette";
import { HoverCard } from "@/components/ui/HoverCard";
import { SiteAvatar } from "@/components/ui/SiteChip";
import { dimGrid, type Entry } from "@/lib/arena/explain";
import { evidenceLines, splitFinal } from "@/lib/arena/view";
import { DIMENSIONS } from "@/lib/arena/types";
import type { ContenderState, Run } from "@/lib/computer/run";

export const LABEL = "text-[11.5px] uppercase tracking-[0.14em] text-fg-dim";
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Column headings that fit over a cell; the tooltip has the full name. */
const SHORT: Record<(typeof DIMENSIONS)[number], string> = { evidence: "Evid.", consistency: "Cons.", calibration: "Calib.", actionability: "Action", fit: "Fit" };

/** A block of the results: a small label, an optional line of context, then the content. Only whitespace and a hairline separate blocks. */
export function Section({ title, note, children, id }: { title: string; note?: string; children: ReactNode; id?: string }) {
  return (
    <section className="space-y-4 border-t border-line pt-8" aria-label={title} data-testid={id}>
      <div className="space-y-1.5"><h3 className={LABEL}>{title}</h3>{note && <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-fg-muted">{note}</p>}</div>
      {children}
    </section>
  );
}

/** Numbers that matter, side by side: a label above and the value in large type. */
export function Figures({ items }: { items: { label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}><dt className="text-[12px] text-fg-dim">{i.label}</dt><dd className="mt-1 font-serif text-[28px] leading-none text-fg">{i.value}</dd>{i.sub && <p className="mt-1 text-[12px] text-fg-dim">{i.sub}</p>}</div>
      ))}
    </dl>
  );
}

/** The combined outcome under its headings. List lines ("- (Skeptic) ...") become a list. */
export function Outcome({ text }: { text: string }) {
  const parts = splitFinal(text);
  return (
    <div className="space-y-5" data-testid="outcome">
      {parts.map((p, i) => {
        const items = p.lines.filter((l) => /^[-*•]\s+/.test(l));
        const prose = p.lines.filter((l) => !/^[-*•]\s+/.test(l));
        return (
          <div key={i} className="space-y-1.5">
            {p.title && <h4 className="text-[12.5px] font-medium text-fg-muted">{p.title}</h4>}
            {prose.map((l, k) => <p key={k} className={`font-serif leading-relaxed text-fg ${i === 0 ? "text-[19px]" : "text-[16px]"}`}>{l}</p>)}
            {items.length > 0 && <ul className="list-disc space-y-1 pl-5 font-serif text-[16px] leading-relaxed text-fg marker:text-fg-dim">{items.map((l, k) => <li key={k}>{l.replace(/^[-*•]\s+/, "")}</li>)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

export function WhyList({ bullets }: { bullets: string[] }) {
  return <ul className="space-y-2.5" data-testid="why-list">{bullets.map((b) => <li key={b} className="max-w-[68ch] border-l border-dock-line pl-4 text-[14.5px] leading-relaxed text-fg">{b}</li>)}</ul>;
}

/** The five dimensions for everyone: a radar on the left, a heat map on the right. The winner's outline is drawn first. */
export function Compare({ entries, winnerId, series }: { entries: readonly Entry[]; winnerId?: string; series?: { name: string; values: number[] }[] }) {
  const judged = entries.filter((e) => e.score.dims);
  if (judged.length === 0) return <p className="text-[13.5px] text-fg-muted">No judge answered, so there are no dimension scores to compare. The ranking used only what was counted.</p>;
  const ordered = [...judged].sort((a, b) => Number(b.id === winnerId) - Number(a.id === winnerId));
  const radar = series ?? ordered.map((e) => ({ name: e.name, values: DIMENSIONS.map((d) => e.score.dims![d] / 10) }));
  const grid = dimGrid(ordered);
  return (
    <div className="grid items-center gap-8 md:grid-cols-2" data-testid="compare">
      <div>
        <RadarChart axes={DIMENSIONS.map(cap)} series={radar} size={300} />
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">{radar.map((s, i) => <li key={s.name} className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted"><span className="size-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{s.name}</li>)}</ul>
      </div>
      <Heatmap rows={grid.rows} cols={grid.cols.map((d) => SHORT[d])} values={grid.values} cell={38} tip={(r, c, v) => `${grid.rows[r]} · ${cap(grid.cols[c])}: ${v === null ? "no data" : `${Math.round(v * 10)} out of 10`}`} />
    </div>
  );
}

/** A site named in a report: its tile and host, with the page it points at in a card when the agent really opened that site. */
function SourceChip({ c, host, n }: { c: ContenderState; host: string; n: number | null }) {
  const chip = <span className="press inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 pl-1 pr-2 text-[11.5px] text-fg-muted hover:text-fg"><SiteAvatar host={host} size={13} /><span className="max-w-[10rem] truncate">{host}</span></span>;
  if (n === null) return <span title="Named in the report; this agent did not open that page" className="opacity-80">{chip}</span>;
  return <HoverCard card={<CiteCard ns={[n]} sources={c.run.sources} />} width={320}><button type="button" className="rounded-full">{chip}</button></HoverCard>;
}

/** What each agent concluded, in its own words: headline, prediction and its evidence lines, each with the site it came from. */
export function Voices({ list, winnerId, place }: { list: readonly ContenderState[]; winnerId: string; place?: (id: string) => string | null }) {
  return (
    <ul className="space-y-10" data-testid="voices">
      {list.map((c) => {
        const o = c.outcome;
        const lines = evidenceLines(c);
        return (
          <li key={c.info.id} className="space-y-3">
            <div className="flex items-center gap-2.5">
              <FlatOrb size={22} look={lookFor(c.info.id, "battle")} interactive={false} />
              <h4 className={`text-[14px] ${c.info.id === winnerId ? "font-medium text-fg" : "text-fg-muted"}`}>{c.info.name}</h4>
              <span className="text-[12.5px] text-fg-dim">{[place?.(c.info.id), c.score ? `${c.score.total} out of 10` : null].filter(Boolean).join(" · ")}</span>
            </div>
            {o ? (
              <>
                <p className="max-w-[68ch] font-serif text-[17px] leading-snug text-fg">{o.headline}</p>
                <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-fg-muted">{o.prediction} <span className="text-fg-dim">({Math.round(o.confidence * 100)}% sure)</span></p>
                {lines.length > 0 && (
                  <ul className="max-w-[68ch] space-y-1.5 border-l border-line pl-4">
                    {lines.map((l, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-fg-muted">
                        <span>{l.claim}</span>
                        {l.host && <SourceChip c={c} host={l.host} n={l.n} />}
                      </li>
                    ))}
                  </ul>
                )}
                {o.risks.length > 0 && <p className="max-w-[68ch] text-[12.5px] text-fg-dim">Risks it named: {o.risks.join(" · ")}</p>}
              </>
            ) : <p className="text-[13px] text-fg-dim">This agent did not produce a report.</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** The points the combined answer took from the others, each tied to the agent that made it. */
export function Provenance({ items, names }: { items: readonly { id: string; point: string }[]; names: Record<string, string> }) {
  if (items.length === 0) return <p className="text-[13.5px] text-fg-muted">The combined outcome used the winner&apos;s report alone.</p>;
  return <ul className="max-w-[68ch] space-y-1.5">{items.map((p, i) => <li key={i} className="text-[14px] leading-relaxed text-fg"><span className="text-fg-dim">{names[p.id] ?? "An agent"} · </span>{p.point}</li>)}</ul>;
}

/** The report and score table the contest wrote, as buttons that open them in the artifact panel. */
export function Files({ run }: { run: Run }) {
  const { openTab } = useAgent();
  const files = (run.agents.find((a) => a.id === "main")?.files ?? []).filter((f) => f.mode !== "read");
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => <button key={f.id} type="button" onClick={() => openTab(fileTab(f.path))} className="press h-8 rounded-full border border-line px-3 font-mono text-[12px] text-fg-muted hover:border-dock-line hover:text-fg">{f.path.replace(/^\/workspace\/(artifacts\/)?/, "")}</button>)}
    </div>
  );
}
