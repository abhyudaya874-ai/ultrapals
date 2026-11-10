"use client";
import { useMemo } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { stability } from "@/lib/arena/diff";
import { calibrationPoints, evidenceMatrix, loopCurve, whyBullets } from "@/lib/arena/explain";
import { DIMENSIONS } from "@/lib/arena/types";
import { entriesOf, roundViews } from "@/lib/arena/view";
import type { ArenaState, Run } from "@/lib/computer/run";
import { Calibration, EvidenceMatrix, ScoreCurve } from "./ArenaCharts";
import { DiffView, RoundBrief } from "./Diff";
import { Compare, Figures, Files, LABEL, Outcome, Provenance, Section, Voices, WhyList } from "./ResultsParts";

/**
 * The end of a Loop. The best round and how far the answer came, why that round won, the score of every round, what changed from each round to
 * the next, the first round against the best on the same five measures, whether the best prediction held across the other scenarios, and the same
 * evidence, sources and provenance as a Battle.
 */
export function LoopResults({ run, a }: { run: Run; a: ArenaState }) {
  const final = a.final!;
  const views = useMemo(() => roundViews(a), [a]);
  const entries = useMemo(() => entriesOf(a).sort((x, y) => (a.contenders.find((c) => c.info.id === x.id)?.info.round ?? 0) - (a.contenders.find((c) => c.info.id === y.id)?.info.round ?? 0)), [a]);
  const names = useMemo(() => Object.fromEntries(a.contenders.map((c) => [c.info.id, c.info.name])), [a.contenders]);
  const best = views.find((v) => v.best);
  const first = views[0];
  const bullets = useMemo(() => whyBullets(entries, final.winner, final.why || undefined), [entries, final]);
  const hold = useMemo(() => stability(entries, final.winner), [entries, final.winner]);
  const curve = useMemo(() => loopCurve(entries).map((p, i) => ({ ...p, round: views[i]?.round ?? p.round, name: views[i]?.c.info.scenarioName ?? views[i]?.c.info.name ?? `Round ${p.round}` })), [entries, views]);
  if (!best?.entry) return null;
  const stop = a.phaseNote?.replace(/^Loop stopped:\s*/i, "");
  const o = best.c.outcome;
  const start = first?.entry?.score.total;
  const radar = first?.entry?.score.dims && best.entry.score.dims && first.c.info.id !== best.c.info.id
    ? [first, best].map((v) => ({ name: `Round ${v.round}${v === best ? " (best)" : ""}`, values: DIMENSIONS.map((d) => v.entry!.score.dims![d] / 10) }))
    : undefined;
  return (
    <article className="mx-auto max-w-[940px] space-y-12 px-6 pb-20 pt-8" data-testid="loop-results">
      <header className="flex items-center gap-6">
        <BattleOrb id={best.c.info.id} size={88} state="ok" tool={best.c.info.tool} winner />
        <div className="min-w-0">
          <p className={LABEL}>Best round</p>
          <h2 className="font-serif text-[36px] leading-tight text-fg">Round {best.round} · {best.c.info.scenarioName ?? best.c.info.name}</h2>
          {o && <p className="mt-1 max-w-[60ch] text-[15px] leading-snug text-fg-muted">{o.headline}</p>}
        </div>
      </header>
      <Figures items={[
        { label: "Best score", value: best.entry.score.total, sub: "out of 10" },
        { label: "First round", value: start ?? "–", sub: start !== undefined && start !== best.entry.score.total ? `${best.entry.score.total > start ? "+" : "−"}${Math.abs(Math.round((best.entry.score.total - start) * 10) / 10)} by the best round` : "the best round was the first" },
        { label: "Rounds run", value: views.length, sub: a.adaptive ? `of up to ${a.max}` : `of ${a.max} planned` },
        { label: "Held up in", value: hold ? `${hold.held} of ${hold.of}` : "–", sub: hold ? "other scenarios" : "no other round to compare" },
      ]} />
      {stop && <p className="max-w-[68ch] text-[14px] leading-relaxed text-fg-muted" data-testid="stop-reason">The loop stopped because {stop.charAt(0).toLowerCase() + stop.slice(1)}.</p>}

      <Section title="The combined outcome" note="Written from the best round plus the best verified points of the others."><Outcome text={final.text} /></Section>
      <Section title="Why this round" note="Each line is computed from the scores and counted facts."><WhyList bullets={bullets} /></Section>
      <Section title="Score by round" note="Bars are each round's score. The dashed line is the best so far."><ScoreCurve rounds={curve} bestRound={best.round} /></Section>
      <Section title="What changed from round to round" note="Each round tested a different version of the scenario, and was told what the best answer so far was missing.">
        <ol className="space-y-6 border-l border-line pl-5">
          {views.map((v) => (
            <li key={v.c.info.id} className="relative" data-testid="round-change">
              <span className={`absolute -left-[25px] top-1.5 size-2 rounded-full ${v.best ? "bg-fg" : "bg-line"}`} aria-hidden />
              <h4 className="mb-2 text-[13.5px] font-medium text-fg">Round {v.round} · {v.c.info.scenarioName ?? v.c.info.name}{v.best && <span className="ml-2 font-normal text-fg-dim">best</span>}</h4>
              {v.diff ? <DiffView d={v.diff} /> : <RoundBrief info={v.c.info} />}
            </li>
          ))}
        </ol>
      </Section>
      <Section title={radar ? "The first round against the best" : "How the rounds compared"} note="The blind judge scored every round on the same five measures."><Compare entries={entries} winnerId={final.winner} series={radar} /></Section>
      {hold && (
        <Section title="Does the answer hold up?" note={`The best round's prediction shares most of its wording with ${hold.held} of the ${hold.of} other scenarios' predictions. A prediction that survives different assumptions is more trustworthy.`}>
          <ul className="max-w-[560px] space-y-2">
            {hold.rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(6rem,12rem)_1fr_4.5rem] items-center gap-3 text-[12.5px]">
                <span className="truncate text-fg-muted">{r.name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${r.held ? "bg-fg" : "bg-fg-dim"}`} style={{ width: `${Math.max(3, r.overlap * 100)}%` }} /></span>
                <span className={`text-right ${r.held ? "text-fg" : "text-fg-dim"}`}>{r.held ? "held" : "differed"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Sure of itself, and right to be?" note="Each round's stated confidence against how well it scored."><Calibration points={calibrationPoints(entries)} winnerId={final.winner} /></Section>
      <Section title="Where the evidence agrees" note="A site cited in two or more rounds, which worked independently, is corroborated."><EvidenceMatrix rows={evidenceMatrix(entries)} cols={views.map((v) => ({ id: v.c.info.id, name: `Round ${v.round}` }))} /></Section>
      <Section title="In their own words" note="Each round's conclusion and its evidence. Point at a site to see the page it found."><Voices list={views.map((v) => v.c)} winnerId={final.winner} /></Section>
      <Section title="Where the combined answer came from"><Provenance items={final.provenance} names={names} /></Section>
      <Files run={run} />
    </article>
  );
}
