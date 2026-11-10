"use client";
import { ROW_H, TRACK, admitChart, chartRows, defaultSpec, scorecardLayout } from "@/lib/pals/chart";
import type { ExamCard } from "@/lib/pals/card";

const LABEL_W = 96;
const TONE = { BAR_MET: "var(--color-ok)", BAR_MISSED: "var(--color-bad)", NOT_MEASURABLE: "var(--color-warn)", NOT_APPLICABLE: "var(--color-fg-dim)" } as const;
const WORD = { BAR_MET: "met", BAR_MISSED: "missed", NOT_MEASURABLE: "not measurable", NOT_APPLICABLE: "n/a" } as const;

/** Observed against pass line for every exam row and SuperPal. Marks are not colour alone: solid = measured, dashed outline = could not measure. */
export function ExamChart({ card }: { card: ExamCard }) {
  const rows = chartRows(card);
  const spec = defaultSpec(card);
  const a = admitChart(spec, rows);
  if (!a.ok || a.kind !== "scorecard") return null;
  const bars = scorecardLayout(a.rows);
  const h = bars.length * ROW_H;
  return (
    <figure className="space-y-1" data-testid="exam-chart">
      <figcaption className="text-[12.5px] text-fg-dim">{spec.title}</figcaption>
      <svg viewBox={`0 0 ${LABEL_W + TRACK + 90} ${h}`} role="img" aria-label={spec.title} className="w-full max-w-[420px]">
        {bars.map((b) => (
          <g key={b.id} transform={`translate(0 ${b.y})`}>
            <text x={0} y={16} fontSize={11.5} fill="var(--color-fg-muted)">{b.label}</text>
            {b.fill === null ? (
              <rect x={LABEL_W} y={5} width={TRACK} height={14} rx={3} fill="none" stroke={TONE[b.status]} strokeDasharray="4 3" />
            ) : (
              <>
                <rect x={LABEL_W} y={5} width={TRACK} height={14} rx={3} fill="var(--color-surface-2)" />
                <rect x={LABEL_W} y={5} width={Math.max(b.fill, 0)} height={14} rx={3} fill={TONE[b.status]} opacity={0.85} />
              </>
            )}
            {b.tick !== null && <line x1={LABEL_W + b.tick} x2={LABEL_W + b.tick} y1={2} y2={22} stroke="var(--color-fg)" strokeWidth={1.5} />}
            <text x={LABEL_W + TRACK + 8} y={16} fontSize={11} fill={TONE[b.status]}>{WORD[b.status]}</text>
          </g>
        ))}
      </svg>
      <p className="text-[12px] text-fg-dim">{spec.why}</p>
    </figure>
  );
}
