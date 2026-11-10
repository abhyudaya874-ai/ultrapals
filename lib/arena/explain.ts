import { detParts, type DetPart } from "./judge";
import { DIMENSIONS, type Dim, type Facts, type MatchResult, type Outcome, type Score } from "./types";

/** What the report needs to know about one contender, joined up. */
export interface Entry {
  id: string;
  name: string;
  outcome: Outcome | null;
  facts: Facts | null;
  score: Score;
  /** Sources this contender found: [n] -> host. */
  sources: { n: number; host: string; title?: string }[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Pure. 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ["th", "st", "nd", "rd"];
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

export interface Edge { dim: Dim; winner: number; others: number; delta: number; leads: boolean }
/** Pure. For each dimension, the winner's score against the other contenders' average, biggest advantage first. Needs a judge; otherwise empty. */
export function winnerEdge(entries: readonly Entry[], winnerId: string): Edge[] {
  const w = entries.find((e) => e.id === winnerId);
  if (!w?.score.dims) return [];
  const rest = entries.filter((e) => e.id !== winnerId && e.score.dims);
  return DIMENSIONS.map((dim): Edge => {
    const others = rest.map((e) => e.score.dims![dim]);
    return { dim, winner: w.score.dims![dim], others: r1(mean(others)), delta: r1(w.score.dims![dim] - mean(others)), leads: others.every((o) => w.score.dims![dim] >= o) };
  }).sort((a, b) => b.delta - a.delta);
}

/** Pure. A rows × dimensions grid for a heatmap or radar (null where there was no judge). */
export const dimGrid = (entries: readonly Entry[]): { rows: string[]; cols: readonly Dim[]; values: (number | null)[][] } => ({
  rows: entries.map((e) => e.name),
  cols: DIMENSIONS,
  values: entries.map((e) => DIMENSIONS.map((d) => (e.score.dims ? e.score.dims[d] / 10 : null))),
});

/** Pure. How the counted part of a score was earned. The points always add up to `score.det`. */
export const detBreakdown = (e: Entry): DetPart[] => (e.facts ? detParts(e.facts, e.outcome) : []);

/** Pure. A source string from a report ("stripe.com", "[3]", "https://x.test/a") as a host, using the contender's own numbered sources for [n]. */
export function hostOfSource(src: string | undefined, sources: readonly { n: number; host: string }[]): string | null {
  if (!src) return null;
  const n = /^\[?(\d{1,2})\]?$/.exec(src.trim());
  if (n) return sources.find((s) => s.n === Number(n[1]))?.host ?? null;
  const m = /([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(src.replace(/^https?:\/\//i, ""));
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

export interface Corroboration { host: string; by: string[] }
/** Pure. Which sites were cited by which contenders, most shared first. A site cited by two or more independent contenders is corroborated. */
export function evidenceMatrix(entries: readonly Entry[]): Corroboration[] {
  const by = new Map<string, Set<string>>();
  for (const e of entries) {
    const hosts = new Set<string>();
    for (const ev of e.outcome?.evidence ?? []) { const h = hostOfSource(ev.source, e.sources); if (h) hosts.add(h); }
    for (const h of hosts) by.set(h, (by.get(h) ?? new Set()).add(e.id));
  }
  return [...by.entries()].map(([host, ids]) => ({ host, by: [...ids] })).sort((a, b) => b.by.length - a.by.length || a.host.localeCompare(b.host));
}

/** Pure. Confidence against score: a well-calibrated contender is confident when its evidence is strong. */
export const calibrationPoints = (entries: readonly Entry[]): { id: string; name: string; confidence: number; total: number }[] =>
  entries.flatMap((e) => (e.outcome ? [{ id: e.id, name: e.name, confidence: Math.round(e.outcome.confidence * 100), total: e.score.total }] : []));

/**
 * Pure. Plain sentences saying what made the winner the best, each one computed from the numbers, so every sentence is true of the data.
 * A sentence about a dimension only appears when the winner led on it.
 */
export function whyBullets(entries: readonly Entry[], winnerId: string, judgeWhy?: string): string[] {
  const sorted = [...entries].sort((a, b) => b.score.total - a.score.total);
  const w = sorted.find((e) => e.id === winnerId);
  if (!w) return [];
  const out: string[] = [];
  const next = sorted.find((e) => e.id !== winnerId);
  if (w.score.total < sorted[0].score.total) {
    // a knockout rewards beating the opponent in front of you, so the champion need not have the best average
    const place = sorted.findIndex((e) => e.id === winnerId) + 1;
    out.push(`Won the knockout on head-to-head results. Its average score, ${w.score.total} out of 10, was ${ordinal(place)} of ${sorted.length}: each match is decided by the two reports side by side, not by the average.`);
  } else if (next) {
    const gap = r1(w.score.total - next.score.total);
    out.push(gap > 0 ? `Highest total score, ${w.score.total} out of 10, ${gap} ahead of ${next.name} (${next.score.total}).` : `Tied on total score with ${next.name} (${w.score.total}); it won the tie on counted evidence.`);
  }
  const edge = winnerEdge(entries, winnerId);
  const leads = edge.filter((e) => e.leads && e.delta > 0).slice(0, 3);
  if (leads.length) out.push(`Led on ${leads.map((e) => `${e.dim} (${e.winner} against an average of ${e.others})`).join(", ")}.`);
  const others = entries.filter((e) => e.id !== winnerId && e.facts);
  if (w.facts && others.length) {
    const avg = r1(mean(others.map((e) => e.facts!.cited)));
    if (w.facts.cited > avg) out.push(`Cited ${w.facts.cited} source${w.facts.cited === 1 ? "" : "s"}; the others cited ${avg} on average.`);
    const kinds = new Set(w.facts.roles.filter((r) => ["research", "browser", "terminal"].includes(r)));
    if (kinds.size >= 2) out.push(`Used ${[...kinds].join(", ")} to check its claims.`);
  }
  const weakest = w.score.dims ? [...DIMENSIONS].sort((a, b) => w.score.dims![a] - w.score.dims![b])[0] : null;
  if (weakest && w.score.dims && w.score.dims[weakest] < 8) out.push(`Its weakest point was ${weakest} (${w.score.dims[weakest]}/10)${w.score.weakness ? `: ${w.score.weakness}` : "."}`);
  if (judgeWhy) out.push(`The blind judge's reason: ${judgeWhy}`);
  if (!w.score.dims) out.push("No judge answered, so this ranking uses only what was counted (sources cited, kinds of work, files, errors).");
  return out;
}

/** Pure. Round-by-round best-so-far for a loop: [round, score of that round, best total so far]. */
export function loopCurve(entries: readonly Entry[]): { round: number; score: number; best: number }[] {
  let best = 0;
  return entries.map((e, i) => { best = Math.max(best, e.score.total); return { round: i + 1, score: e.score.total, best }; });
}

/** Pure. The last line of a match card: how the two reports were compared. */
export function unjudgedNote(m: Pick<MatchResult, "judged" | "judgeWhy" | "unjudged">): string {
  if (m.judged) return `Scored side by side by a blind judge${m.judgeWhy ? `: ${m.judgeWhy}` : "."}`;
  const counted = "what was counted (sources cited, kinds of work, files, errors) decided it.";
  return m.unjudged === "no_report" ? `One team did not finish a report, so there was nothing for the judge to compare; ${counted}` : `No judge answered, so ${counted}`;
}
