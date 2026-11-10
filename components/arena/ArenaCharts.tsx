import { niceTicks, scale } from "@/components/charts/geometry";
import type { Corroboration, Entry } from "@/lib/arena/explain";
import { DET_WEIGHT, LLM_WEIGHT } from "@/lib/arena/judge";

const TEXT = "#979aa0";
const AXIS = "#6f7277";
const GRID = "#282b2f";
const FG = "#dbdee3";

/** How each score was made: the counted part (sources, kinds of work, files) and the judged part (the blind judge's five dimensions), stacked. */
export function ScoreBars({ entries, winnerId }: { entries: readonly Entry[]; winnerId: string }) {
  const rows = [...entries].sort((a, b) => b.score.total - a.score.total);
  return (
    <div data-testid="score-bars">
      <ul className="space-y-2.5">
        {rows.map((e) => {
          const counted = DET_WEIGHT * e.score.det;
          const judged = e.score.llm === null ? 0 : LLM_WEIGHT * e.score.llm;
          return (
            <li key={e.id} className="grid grid-cols-[minmax(5rem,9rem)_1fr_2.5rem] items-center gap-3 text-[12.5px]" title={`${e.name}: counted ${e.score.det} out of 10 (40%), judged ${e.score.llm ?? "not judged"} (60%)`}>
              <span className={`truncate ${e.id === winnerId ? "font-medium text-fg" : "text-fg-muted"}`}>{e.name}</span>
              <span className="flex h-2 overflow-hidden rounded-full bg-surface-2">
                <span className="h-full bg-fg-dim" style={{ width: `${counted * 10}%` }} />
                <span className="h-full bg-fg" style={{ width: `${judged * 10}%` }} />
              </span>
              <span className="text-right tabular-nums text-fg">{e.score.total}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex gap-4 text-[11.5px] text-fg-dim"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-fg-dim" />Counted by code, 40%</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-fg" />Blind judge, 60%</span></p>
    </div>
  );
}

/** Stated confidence against how good the report was. On the dashed line, a report is as sure as it should be; above it, overconfident. */
export function Calibration({ points, winnerId }: { points: readonly { id: string; name: string; confidence: number; total: number }[]; winnerId: string }) {
  if (points.length === 0) return <p className="grid h-32 place-items-center text-[12.5px] text-fg-dim">No reports to compare.</p>;
  const W = 360;
  const H = 260;
  const pad = { l: 38, r: 14, t: 12, b: 34 };
  const x = scale(0, 100, pad.l, W - pad.r);
  const y = scale(0, 100, H - pad.b, pad.t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[420px]" role="img" aria-label="Confidence against score">
      {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>{v}</text><text x={x(v)} y={H - pad.b + 14} textAnchor="middle" fontSize={10} fill={AXIS}>{v}</text></g>)}
      <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke={AXIS} strokeDasharray="4 4" />
      <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill={TEXT}>stated confidence, %</text>
      <text x={11} y={H / 2} textAnchor="middle" fontSize={10.5} fill={TEXT} transform={`rotate(-90 11 ${H / 2})`}>score, out of 100</text>
      {points.map((p) => {
        const win = p.id === winnerId;
        const cx = x(p.confidence);
        const cy = y(p.total * 10);
        return (
          <g key={p.id}>
            <circle cx={cx} cy={cy} r={win ? 6 : 4.5} fill={win ? FG : "none"} stroke={FG} strokeWidth={1.5}><title>{`${p.name}: ${p.confidence}% sure, scored ${p.total} out of 10`}</title></circle>
            <text x={cx + 9} y={cy + 3.5} fontSize={10.5} fill={win ? FG : TEXT}>{p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Sites by contender: a dot where the contender cited the site. A site cited by two or more independent contenders is corroborated. */
export function EvidenceMatrix({ rows, cols }: { rows: readonly Corroboration[]; cols: readonly { id: string; name: string }[] }) {
  if (rows.length === 0) return <p className="grid h-24 place-items-center text-[12.5px] text-fg-dim">No sites were cited in the evidence.</p>;
  return (
    <div className="overflow-x-auto" data-testid="evidence-matrix">
      <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-fg-dim">
            <th className="pb-2 font-normal">Site</th>
            {cols.map((c) => <th key={c.id} className="pb-2 text-center font-normal"><span className="block max-w-[6.5rem] truncate">{c.name}</span></th>)}
            <th className="pb-2 text-right font-normal">Cited by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.host} className="border-t border-line">
              <td className={`py-1.5 pr-3 ${r.by.length > 1 ? "text-fg" : "text-fg-muted"}`}>{r.host}</td>
              {cols.map((c) => <td key={c.id} className="py-1.5 text-center">{r.by.includes(c.id) ? <span className="inline-block size-2 rounded-full bg-fg" aria-label="cited" /> : <span className="inline-block size-1 rounded-full bg-line" aria-hidden />}</td>)}
              <td className={`py-1.5 text-right tabular-nums ${r.by.length > 1 ? "text-fg" : "text-fg-dim"}`}>{r.by.length > 1 ? `${r.by.length} · corroborated` : "1"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A loop's progress: each round's score as a bar, the best so far as a line, and the scenario under each round. */
export function ScoreCurve({ rounds, bestRound }: { rounds: readonly { round: number; name: string; score: number; best: number }[]; bestRound: number }) {
  if (rounds.length === 0) return <p className="grid h-32 place-items-center text-[12.5px] text-fg-dim">No rounds finished.</p>;
  const W = 560;
  const H = 230;
  const pad = { l: 34, r: 12, t: 14, b: 46 };
  const t = niceTicks(0, 10, 5);
  const y = scale(t.min, t.max, H - pad.b, pad.t);
  const slot = (W - pad.l - pad.r) / rounds.length;
  const bw = Math.min(40, slot * 0.5);
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const line = rounds.map((r, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)} ${y(r.best).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score by round" data-testid="score-curve">
      {t.ticks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>{v}</text></g>)}
      {rounds.map((r, i) => (
        <g key={r.round}>
          <rect x={cx(i) - bw / 2} y={y(r.score)} width={bw} height={Math.max(1, y(0) - y(r.score))} rx={4} fill={r.round === bestRound ? FG : "#3b3f45"}><title>{`Round ${r.round}, ${r.name}: ${r.score}`}</title></rect>
          <text x={cx(i)} y={y(r.score) - 5} textAnchor="middle" fontSize={10.5} fill={r.round === bestRound ? FG : TEXT}>{r.score}</text>
          <text x={cx(i)} y={H - 28} textAnchor="middle" fontSize={10.5} fill={TEXT}>{`Round ${r.round}`}</text>
          <text x={cx(i)} y={H - 14} textAnchor="middle" fontSize={9.5} fill={AXIS}>{r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name}</text>
        </g>
      ))}
      <path d={line} fill="none" stroke={FG} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="5 4" />
      {rounds.map((r, i) => <circle key={`d${r.round}`} cx={cx(i)} cy={y(r.best)} r={2.5} fill={FG}><title>{`Best so far after round ${r.round}: ${r.best}`}</title></circle>)}
    </svg>
  );
}
