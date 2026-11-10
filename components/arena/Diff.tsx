import type { RoundDiff } from "@/lib/arena/diff";
import type { ContenderInfo } from "@/lib/arena/types";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sign = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
const tone = (n: number | null): string => (n === null || n === 0 ? "text-fg-muted" : n > 0 ? "text-ok" : "text-bad");

export function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex h-6 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] tabular-nums ${className}`}>{children}</span>;
}

/**
 * Before a round starts: how it differs from the last one. The scenario's change, what the best answer so far was judged to lack (which this
 * round was told to fix) and the score it has to beat.
 */
export function RoundBrief({ info }: { info: ContenderInfo }) {
  const change = info.scenario?.slice((info.scenarioName?.length ?? 0) + 2) ?? "";
  return (
    <div className="space-y-2.5 text-[13.5px] leading-relaxed" data-testid="round-brief">
      <p><span className="text-fg-dim">This round tests </span><span className="font-medium text-fg">{info.scenarioName ?? info.name}</span>{change && <span className="text-fg-muted">. {change}</span>}</p>
      {info.beat ? (
        <>
          {info.beat.weakness && <p><span className="text-fg-dim">It was told the best answer so far lacks: </span><span className="text-fg-muted">{info.beat.weakness}</span></p>}
          <p><span className="text-fg-dim">Score to beat: </span><span className="tabular-nums text-fg">{info.beat.score}</span></p>
        </>
      ) : <p className="text-fg-dim">The first round: nothing to beat yet.</p>}
    </div>
  );
}

/** After a round: what changed from the one before, as chips and short lines. Only changes that happened are shown. */
export function DiffView({ d }: { d: RoundDiff }) {
  const moved = d.dims.filter((x) => x.delta !== null && x.delta !== 0);
  const biggest = [...moved].sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 4);
  return (
    <div className="space-y-3" data-testid="round-diff">
      <div className="flex flex-wrap items-center gap-1.5">
        {d.score.delta !== null && <Chip className={`${tone(d.score.delta)} border-dock-line`}>{d.score.delta > 0 ? "▲" : d.score.delta < 0 ? "▼" : "•"} score {d.score.from} → {d.score.to}</Chip>}
        {biggest.map((x) => <Chip key={x.dim} className={tone(x.delta)}>{cap(x.dim)} {sign(x.delta!)}</Chip>)}
        {d.confidence && d.confidence.from !== d.confidence.to && <Chip className="text-fg-muted">Confidence {d.confidence.from}% → {d.confidence.to}%</Chip>}
      </div>
      <ul className="space-y-1 text-[13px] leading-relaxed text-fg-muted">
        {d.scenario.from && <li><span className="text-fg-dim">Scenario: </span>{d.scenario.from} → <span className="text-fg">{d.scenario.to}</span></li>}
        {d.predictionOverlap !== null && <li><span className="text-fg-dim">Prediction: </span>{d.predictionChanged ? "it changed its mind" : "the same call, in other words"}</li>}
        {(d.sites.added.length > 0 || d.sites.dropped.length > 0) && (
          <li><span className="text-fg-dim">Sources: </span>{d.sites.added.length > 0 && <span className="text-ok">+{d.sites.added.join(", +")}</span>}{d.sites.added.length > 0 && d.sites.dropped.length > 0 && " "}{d.sites.dropped.length > 0 && <span className="text-bad">−{d.sites.dropped.join(", −")}</span>}{d.sites.kept.length > 0 && <span className="text-fg-dim"> · kept {d.sites.kept.length}</span>}</li>
        )}
        {d.targeted && (
          <li><span className="text-fg-dim">It was asked to fix: </span>{d.targeted.weakness.replace(/[.\s]+$/, "")}. <span className={d.targeted.addressed ? "text-ok" : "text-fg-dim"}>{d.targeted.addressed ? `The report now covers ${d.targeted.matched.slice(0, 4).join(", ")}.` : "The report does not mention it."}</span></li>
        )}
      </ul>
    </div>
  );
}
