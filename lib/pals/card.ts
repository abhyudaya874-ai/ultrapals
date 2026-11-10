import type { ExamResult } from "./exam";
import type { SuperPalRow } from "./superpals";
import type { GenResult, RivalEntry } from "./generate";

/** Everything the UI and the main agent need about one exam. Plain JSON: it crosses the SSE stream unchanged. */
export interface ExamCard extends Omit<ExamResult, "archetypes"> {
  contract: string;
  rivals: RivalEntry[];
  rejected: number;
  queries: string[];
  pages: number;
  superpals: SuperPalRow[];
  measuredFrom: string[];
}

export function buildCard(contract: string, gen: GenResult, exam: ExamResult, superpals: SuperPalRow[] = [], measuredFrom: string[] = []): ExamCard {
  const { archetypes: _a, ...rest } = exam;
  return { ...rest, contract: contract.slice(0, 300), rivals: gen.entries, rejected: gen.rejected.length, queries: gen.queries, pages: gen.pages.length, superpals, measuredFrom };
}

/** Pure. The text UltraPal reads back: what was sealed and why, row by row, with the cited sources. Never claims more than was measured. */
export function summarizeCard(c: ExamCard): string {
  const lines = [`Exam result: ${c.seal.seal} (${c.seal.reason}).`];
  for (const r of c.rows) lines.push(`- ${r.archetype}: ${r.status}${r.observed === null ? "" : ` (observed ${r.observed}, bar ${r.bar.op} ${r.bar.value}, ${r.bar.provenance})`}${r.note ? ` - ${r.note}` : ""}`);
  lines.push(`Attacks on the judge: ${c.attacks.run.filter((a) => a.survived).length}/${c.attacks.run.length} survived; ${c.attacks.skipped.length} guarded elsewhere.`);
  for (const e of c.rivals) lines.push(`Rival (${e.rival.archetype}, ${e.confidence} confidence): ${e.rival.failureClass} per ${e.rival.thesisOwner}; counter ${e.rival.counter.capability}. Sources: ${e.rival.sources.map((s) => s.url).join(", ")}`);
  if (c.seal.liveConditions.length) lines.push(`Live conditions the program must hold at runtime: ${c.seal.liveConditions.join(", ")}.`);
  for (const s of c.superpals) lines.push(`SuperPal ${s.pal.name} (${s.pal.edge}): ${s.status}${s.observed === null ? ` - ${s.note ?? "not measured"}` : ` (observed ${s.observed}, bar ${s.pal.op} ${s.pal.value})`}; counter ${s.pal.counter.capability}.${s.evidence ? ` Published: "${s.evidence.quote}" (${s.evidence.url}).` : ""}`);
  if (c.measuredFrom.length) lines.push(`Measured from the real promise run: ${c.measuredFrom.join(", ")}.`);
  return lines.join("\n");
}
