import { csvOf } from "@/lib/computer/artifacts";
import { detBreakdown, evidenceMatrix, whyBullets, winnerEdge, type Entry } from "./explain";
import { DIMENSIONS, type ArenaFinal } from "./types";

const pct = (c: number) => `${Math.round(c * 100)}%`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Pure. A markdown report of the whole contest, written to the workspace so it can be opened, downloaded or read by later steps. */
export function reportMarkdown(o: { title: string; mode: "battle" | "loop"; question: string; entries: readonly Entry[]; winnerId: string; final: ArenaFinal | null; judgeWhy?: string }): string {
  const sorted = [...o.entries].sort((a, b) => b.score.total - a.score.total);
  const w = sorted.find((e) => e.id === o.winnerId);
  const lines: string[] = [`# ${o.title}`, "", `**Question:** ${oneLine(o.question)}`, "", `**Mode:** ${o.mode === "battle" ? "Battle" : "Loop"} · ${sorted.length} ${o.mode === "battle" ? "contenders" : "rounds"}`, ""];
  if (w) lines.push(`## Winner: ${w.name} (${w.score.total}/10)`, "", ...whyBullets(o.entries, o.winnerId, o.judgeWhy).map((b) => `- ${b}`), "");
  if (o.final) lines.push("## Combined outcome", "", o.final.text.trim(), "");
  lines.push("## Scores", "", `| ${o.mode === "battle" ? "Contender" : "Round"} | Total | Counted | Judged | ${DIMENSIONS.join(" | ")} |`, `| --- | --- | --- | --- | ${DIMENSIONS.map(() => "---").join(" | ")} |`);
  for (const e of sorted) lines.push(`| ${e.name} | ${e.score.total} | ${e.score.det} | ${e.score.llm ?? "–"} | ${DIMENSIONS.map((d) => e.score.dims?.[d] ?? "–").join(" | ")} |`);
  lines.push("");
  const edge = winnerEdge(o.entries, o.winnerId);
  if (edge.length) lines.push("## What put the winner ahead", "", ...edge.map((e) => `- ${e.dim}: ${e.winner} against an average of ${e.others} (${e.delta >= 0 ? "+" : ""}${e.delta})`), "");
  const shared = evidenceMatrix(o.entries).filter((m) => m.by.length > 1);
  if (shared.length) lines.push("## Sites cited by more than one contender", "", ...shared.map((m) => `- ${m.host}: ${m.by.map((id) => sorted.find((e) => e.id === id)?.name ?? id).join(", ")}`), "");
  lines.push("## What each one said", "");
  for (const e of sorted) {
    lines.push(`### ${e.name}${e.id === o.winnerId ? " (winner)" : ""}`, "");
    if (!e.outcome) { lines.push("_No report._", ""); continue; }
    lines.push(`**${oneLine(e.outcome.headline)}**`, "", `- Prediction (confidence ${pct(e.outcome.confidence)}): ${oneLine(e.outcome.prediction)}`, `- Recommendation: ${oneLine(e.outcome.recommendation) || "–"}`);
    for (const ev of e.outcome.evidence) lines.push(`- Evidence: ${oneLine(ev.claim)}${ev.source ? ` (${ev.source})` : ""}`);
    for (const r of e.outcome.risks) lines.push(`- Risk: ${oneLine(r)}`);
    if (e.score.weakness) lines.push(`- Judge's note: ${oneLine(e.score.weakness)}`);
    const parts = detBreakdown(e);
    if (parts.length) lines.push(`- Counted: ${parts.map((p) => `${p.label} (${p.points}/${p.max})`).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Pure. One row per contender or round, with every score. Cells that came from a web page or a model cannot run as spreadsheet formulas (csvOf). */
export const scoresCsv = (entries: readonly Entry[], winnerId: string): string =>
  csvOf(["name", "winner", "total", "counted", "judged", ...DIMENSIONS, "confidence", "headline", "prediction"], [...entries].sort((a, b) => b.score.total - a.score.total).map((e) => [
    e.name, e.id === winnerId ? "yes" : "", e.score.total, e.score.det, e.score.llm, ...DIMENSIONS.map((d) => e.score.dims?.[d] ?? null),
    e.outcome ? Math.round(e.outcome.confidence * 100) : null, e.outcome?.headline ?? "", e.outcome?.prediction ?? "",
  ]));

/** Pure. When the write-up model fails, the winner's own outcome stands in, in the same format, so the contest still ends with an answer. */
export function fallbackFinalText(winner: Entry): string {
  const o = winner.outcome;
  return [
    `BEST OUTCOME: ${o ? `${oneLine(o.headline)}. Prediction (${pct(o.confidence)} confidence): ${oneLine(o.prediction)} Recommendation: ${oneLine(o.recommendation) || "none given"}` : "The winner produced no report."}`,
    `WHY IT WON: highest total score (${winner.score.total} out of 10).`,
    o && o.risks.length ? `WATCH OUT FOR: ${o.risks.map(oneLine).join("; ")}.` : "WATCH OUT FOR: the winner listed no risks.",
  ].join("\n");
}
