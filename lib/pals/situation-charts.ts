import type { SituationCard } from "./situation";

const VALUE = { yes: 1, partial: 0.5, no: 0 } as const;
/** Pure. 1 = supported, 0.5 = partly, 0 = not supported, null = nobody has cited an answer (unknown is not the same as no). */
export const supportValue = (s: "yes" | "partial" | "no" | "unknown"): number | null => (s === "unknown" ? null : VALUE[s]);
const words = (need: string): string => need.replace(/_/g, " ");

/** Pure. Radar of the top rails across the idea's needs. Unknown counts as 0 here, as in the conservative fit. */
export function radarData(card: SituationCard, top = 3): { axes: string[]; series: { name: string; values: number[] }[] } {
  const rails = card.rails.slice(0, top);
  const axes = card.needs.map((n) => words(n.need));
  return { axes, series: rails.map((r) => ({ name: r.name, values: card.needs.map((n) => supportValue(r.parts.find((p) => p.need === n.need)?.support ?? "unknown") ?? 0) })) };
}

/** Pure. Rails × needs grid for a heatmap; null cells are unanswered. */
export function heatData(card: SituationCard): { rows: string[]; cols: string[]; values: (number | null)[][]; words: string[][] } {
  const label = (s: string) => (s === "yes" ? "supported" : s === "partial" ? "partly supported" : s === "no" ? "not supported" : "no cited answer");
  return {
    rows: card.rails.map((r) => r.name),
    cols: card.needs.map((n) => words(n.need)),
    values: card.rails.map((r) => card.needs.map((n) => supportValue(r.parts.find((p) => p.need === n.need)?.support ?? "unknown"))),
    words: card.rails.map((r) => card.needs.map((n) => label(r.parts.find((p) => p.need === n.need)?.support ?? "unknown"))),
  };
}

/**
 * Pure. How the leader's fit adds up, need by need: each step is that need's share of the total weight times its support. The last bar is the
 * fit itself (the same number as the ranked bar), so the waterfall is a breakdown of it and not a new estimate.
 */
export function leaderWaterfall(card: SituationCard): { rail: string; steps: { label: string; value: number; total?: boolean }[] } | null {
  const lead = card.rails.find((r) => r.rail === card.rubric?.leader) ?? card.rails[0];
  if (!lead) return null;
  const total = card.needs.reduce((a, n) => a + n.weight, 0);
  if (total <= 0) return null;
  const steps = card.needs.map((n) => ({ label: words(n.need), value: Math.round(((n.weight / total) * (supportValue(lead.parts.find((p) => p.need === n.need)?.support ?? "unknown") ?? 0)) * 1000) / 10 }));
  return { rail: lead.name, steps: [...steps, { label: "Fit", value: 0, total: true }] };
}
