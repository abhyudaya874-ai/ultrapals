import { hostOfSource, type Entry } from "./explain";
import { DIMENSIONS, type Dim } from "./types";

const r1 = (n: number): number => Math.round(n * 10) / 10;

const STOP = new Set(("the and for are but not you your with that this from have has had was were will would could should can may might into than then them they their its it's our out over under about after before between because while where when which what who whom whose how why " +
  "any all some more most less least each every both either neither only also just very much many few other such same own too per via not no yes one two").split(/\s+/));

/** Pure. The words that carry meaning in a sentence: lower case, three letters or more, no filler. Numbers count, so "12" in two reports matches. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9.%\s-]/g, " ").split(/\s+/)) {
    const t = w.replace(/^[.-]+|[.-]+$/g, "");
    if (!t) continue;
    if (/\d/.test(t) || (t.length >= 3 && !STOP.has(t))) out.add(t);
  }
  return out;
}

/** Pure. Share of the words two texts have in common, 0..1 (0 when either has none). */
export function overlap(a: string, b: string): number {
  const [x, y] = [tokens(a), tokens(b)];
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

export interface DimDelta { dim: Dim; from: number | null; to: number | null; delta: number | null }
export interface RoundDiff {
  scenario: { from: string | null; to: string };
  score: { from: number | null; to: number; delta: number | null };
  /** Per dimension, biggest gain first. Null values where a judge did not score one of the two rounds. */
  dims: DimDelta[];
  confidence: { from: number; to: number } | null;
  /** Share of words the two predictions have in common. A prediction that moved is one that changed its mind, not only its phrasing. */
  predictionOverlap: number | null;
  predictionChanged: boolean;
  /** Sites cited in the evidence: new this round, no longer used, and used both times. */
  sites: { added: string[]; dropped: string[]; kept: string[] };
  /** What the previous best was judged to lack, and whether this round's report talks about it (a word match, not a judgement). */
  targeted: { weakness: string; matched: string[]; addressed: boolean } | null;
}

/** Pure. The sites a report cites for its evidence. */
export function sitesOf(e: Entry | null): string[] {
  if (!e?.outcome) return [];
  return [...new Set(e.outcome.evidence.flatMap((ev) => { const h = hostOfSource(ev.source, e.sources); return h ? [h] : []; }))];
}

/** Pure. Everything a report says, as one text. */
const textOf = (e: Entry): string => (e.outcome ? [e.outcome.headline, e.outcome.prediction, e.outcome.recommendation, ...e.outcome.evidence.map((x) => x.claim), ...e.outcome.risks].join(" ") : "");

/**
 * Pure. What changed from one round of a loop to the next: the scenario, the score and each dimension, confidence, whether the prediction
 * moved, which sites were added or dropped, and whether the report now talks about what the previous best was missing.
 */
export function roundDiff(prev: Entry | null, cur: Entry, o: { scenarioFrom: string | null; scenarioTo: string; weakness?: string }): RoundDiff {
  const dims = DIMENSIONS.map((dim): DimDelta => {
    const from = prev?.score.dims?.[dim] ?? null;
    const to = cur.score.dims?.[dim] ?? null;
    return { dim, from, to, delta: from !== null && to !== null ? r1(to - from) : null };
  }).sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99));
  const pa = prev?.outcome?.prediction;
  const pb = cur.outcome?.prediction;
  const po = pa && pb ? r1(overlap(pa, pb)) : null;
  const was = new Set(sitesOf(prev));
  const now = sitesOf(cur);
  const weakness = o.weakness?.trim();
  let targeted: RoundDiff["targeted"] = null;
  if (weakness) {
    const want = tokens(weakness);
    const have = tokens(textOf(cur));
    const matched = [...want].filter((t) => have.has(t));
    targeted = { weakness, matched, addressed: want.size > 0 && matched.length >= Math.max(1, Math.ceil(want.size * 0.34)) };
  }
  return {
    scenario: { from: o.scenarioFrom, to: o.scenarioTo },
    score: { from: prev ? prev.score.total : null, to: cur.score.total, delta: prev ? r1(cur.score.total - prev.score.total) : null },
    dims,
    confidence: prev?.outcome && cur.outcome ? { from: Math.round(prev.outcome.confidence * 100), to: Math.round(cur.outcome.confidence * 100) } : null,
    predictionOverlap: po,
    predictionChanged: po !== null && po < 0.6,
    sites: { added: now.filter((h) => !was.has(h)), dropped: [...was].filter((h) => !now.includes(h)), kept: now.filter((h) => was.has(h)) },
    targeted,
  };
}

export interface Stability { held: number; of: number; rows: { id: string; name: string; overlap: number; held: boolean }[] }
/**
 * Pure. How robust the winning prediction is across the other scenarios: a scenario "held" when its own prediction shares at least `min` of its
 * words with the winner's. The winner itself is not counted. Needs at least one other report.
 */
export function stability(entries: readonly Entry[], winnerId: string, min = 0.35): Stability | null {
  const w = entries.find((e) => e.id === winnerId);
  if (!w?.outcome) return null;
  const rows = entries.filter((e) => e.id !== winnerId && e.outcome).map((e) => { const o = r1(overlap(w.outcome!.prediction, e.outcome!.prediction)); return { id: e.id, name: e.name, overlap: o, held: o >= min }; });
  return rows.length ? { held: rows.filter((r) => r.held).length, of: rows.length, rows } : null;
}
