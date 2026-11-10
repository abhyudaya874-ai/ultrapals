import { z } from "zod";
import type { ExamCard } from "./card";
import type { RowStatus } from "./ladder";

/** One plottable row, looked up by id from the sealed card. A chart never holds a number of its own. */
export interface ChartRow {
  id: string;
  label: string;
  group: "exam" | "superpal";
  status: RowStatus;
  observed: number | null;
  bar: number;
  op: "<=" | ">=";
}

/** Pure. Every row of a card, ids stable: `exam:<archetype>` and `superpal:<id>`. */
export function chartRows(card: ExamCard): ChartRow[] {
  return [
    ...card.rows.map((r): ChartRow => ({ id: `exam:${r.archetype}`, label: r.archetype, group: "exam", status: r.status, observed: r.observed, bar: r.bar.value, op: r.bar.op })),
    ...card.superpals.map((s): ChartRow => ({ id: `superpal:${s.pal.id}`, label: s.pal.name, group: "superpal", status: s.status, observed: s.observed, bar: s.pal.value, op: s.pal.op })),
  ];
}

/** What a model (or the default) may write: a kind, a reason and row ids. There is no field for a value, so none can be invented. */
export const ChartSpec = z.object({
  kind: z.enum(["scorecard", "table"]),
  why: z.string().max(160),
  title: z.string().max(80),
  rows: z.array(z.string().max(60)).min(1).max(60),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export type Admitted = { ok: true; kind: ChartSpec["kind"]; rows: ChartRow[]; note?: string } | { ok: false; reason: string };

/** Pure. Refuses a row id that is not in the card; a scorecard needs 3+ rows and at least one measured one, else it falls back to a table. */
export function admitChart(spec: ChartSpec, all: readonly ChartRow[]): Admitted {
  const byId = new Map(all.map((r) => [r.id, r]));
  const missing = spec.rows.filter((id) => !byId.has(id));
  if (missing.length) return { ok: false, reason: `unknown row id: ${missing[0]}` };
  const rows = spec.rows.map((id) => byId.get(id)!);
  if (spec.kind === "scorecard") {
    if (rows.length < 3) return { ok: true, kind: "table", rows, note: "fewer than 3 rows: shown as a table" };
    if (rows.every((r) => r.observed === null)) return { ok: true, kind: "table", rows, note: "nothing was measured: shown as a table" };
  }
  return { ok: true, kind: spec.kind, rows };
}

/** Pure. The default chart: every row of the card, no model involved. */
export function defaultSpec(card: ExamCard): ChartSpec {
  return { kind: "scorecard", title: "Exam and SuperPal scorecard", why: "each bar shows what was observed against its pass line; a dashed outline means it could not be measured", rows: chartRows(card).map((r) => r.id) };
}

export interface BarGeom {
  id: string;
  label: string;
  y: number;
  /** null when not measured: the track is drawn as a break, never as a zero-length bar. */
  fill: number | null;
  tick: number | null;
  status: RowStatus;
}
export const TRACK = 200;
export const ROW_H = 26;

/** Pure and deterministic: same rows, same geometry. Each row is scaled to its own max because the metrics have different units. */
export function scorecardLayout(rows: readonly ChartRow[]): BarGeom[] {
  return rows.map((r, i) => {
    const max = Math.max(r.observed ?? 0, r.bar, 1);
    const px = (v: number) => Math.round((v / max) * TRACK * 100) / 100;
    return {
      id: r.id,
      label: r.label,
      y: i * ROW_H,
      fill: r.observed === null || r.status === "NOT_APPLICABLE" ? null : px(r.observed),
      tick: r.status === "NOT_APPLICABLE" ? null : px(r.bar),
      status: r.status,
    };
  });
}
