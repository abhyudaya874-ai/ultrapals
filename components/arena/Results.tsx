"use client";
import { useMemo } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { calibrationPoints, evidenceMatrix, whyBullets } from "@/lib/arena/explain";
import { entriesOf, pathOf, placeOf } from "@/lib/arena/view";
import type { ArenaState, Run } from "@/lib/computer/run";
import { Calibration, EvidenceMatrix, ScoreBars } from "./ArenaCharts";
import { Bracket } from "./Bracket";
import { Compare, Figures, Files, Outcome, Provenance, Section, Voices, WhyList, LABEL } from "./ResultsParts";

/**
 * The end of a Battle. The champion and the numbers first, then what the others gave, the reasons it won, the knockout, how everyone compared on
 * the same five measures, how the scores were made, how sure each was against how good it was, which sites agree, each agent's own words with its
 * sources, and where the combined answer came from.
 */
export function BattleResults({ run, a }: { run: Run; a: ArenaState }) {
  const final = a.final!;
  const entries = useMemo(() => entriesOf(a), [a]);
  const names = useMemo(() => Object.fromEntries(a.contenders.map((c) => [c.info.id, c.info.name])), [a.contenders]);
  const champ = a.contenders.find((c) => c.info.id === final.winner);
  const entry = entries.find((e) => e.id === final.winner);
  const path = pathOf(a, final.winner);
  const bullets = useMemo(() => whyBullets(entries, final.winner, final.why || undefined), [entries, final]);
  const ranked = useMemo(() => [...a.contenders].sort((x, y) => (y.score?.total ?? 0) - (x.score?.total ?? 0)), [a.contenders]);
  if (!champ) return null;
  const o = champ.outcome;
  return (
    <article className="mx-auto max-w-[940px] space-y-12 px-6 pb-20 pt-8" data-testid="battle-results">
      <header className="flex items-center gap-6">
        <BattleOrb id={champ.info.id} size={88} state="ok" tool={champ.info.tool} winner />
        <div className="min-w-0">
          <p className={LABEL}>Champion</p>
          <h2 className="font-serif text-[36px] leading-tight text-fg">{champ.info.name}</h2>
          {o && <p className="mt-1 max-w-[60ch] text-[15px] leading-snug text-fg-muted">{o.headline}</p>}
        </div>
      </header>
      <Figures items={[
        { label: "Score", value: entry ? entry.score.total : "–", sub: "out of 10" },
        { label: "Health left", value: Math.round(a.hp[final.winner] ?? 0), sub: "after the final" },
        { label: "Confidence", value: o ? `${Math.round(o.confidence * 100)}%` : "–", sub: "in its prediction" },
        { label: "Sources cited", value: champ.facts?.cited ?? 0, sub: `of ${champ.facts?.sources ?? 0} found` },
      ]} />
      {path.length > 0 && <p className="max-w-[68ch] text-[14px] leading-relaxed text-fg-muted" data-testid="champion-path">{path.map((s, i) => `${i === 0 ? "Beat" : "then"} ${s.opponent} in the ${s.label.toLowerCase()}${s.ko ? " by knockout" : ""}${s.hp !== null ? ` (${Math.round(s.hp)} health left)` : ""}`).join(", ")}.</p>}

      <Section title="The combined outcome" note="Written from the champion's report plus the best verified points of the others."><Outcome text={final.text} /></Section>
      <Section title="Why it won" note="Each line is computed from the scores and counted facts, so each one is true of this battle."><WhyList bullets={bullets} /></Section>
      <Section title="The knockout" note="Point at a match to see why one went through and the other did not."><Bracket arena={a} names={names} /></Section>
      <Section title="How they compared" note="The blind judge scored every report on the same five measures, without knowing who wrote it."><Compare entries={entries} winnerId={final.winner} /></Section>
      <Section title="How the scores were made"><ScoreBars entries={entries} winnerId={final.winner} /></Section>
      <Section title="Sure of itself, and right to be?" note="Each report's stated confidence against how well it scored. Above the dashed line means more confident than the evidence supports."><Calibration points={calibrationPoints(entries)} winnerId={final.winner} /></Section>
      <Section title="Where the evidence agrees" note="A site cited by two or more teams that worked independently is corroborated."><EvidenceMatrix rows={evidenceMatrix(entries)} cols={ranked.map((c) => ({ id: c.info.id, name: c.info.name }))} /></Section>
      <Section title="In their own words" note="Each team's conclusion and the evidence it gave. Point at a site to see the page it found."><Voices list={ranked} winnerId={final.winner} place={(id) => placeOf(a, id)} /></Section>
      <Section title="Where the combined answer came from"><Provenance items={final.provenance} names={names} /></Section>
      <Files run={run} />
    </article>
  );
}
