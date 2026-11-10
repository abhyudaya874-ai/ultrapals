import { DIMENSIONS, type Dim, type Facts } from "./types";

/**
 * How one knockout match is scored, as a fight. Each fighter has health. For every one of the five dimensions the judge scores both reports; the
 * higher score lands a hit on the other, as big as the gap times that dimension's weight. Cited sources are armour (3% less damage each, up to
 * 18%). Whoever has more health left wins; a fighter at zero is knocked out. Every number comes from the judge's scores and the counted facts,
 * so each hit can be shown, and explained, in the interface.
 */
export const MAX_HP = 100;
/** Evidence is the heaviest hit; fit and actionability the lightest. Total 12, so a complete 10-0 sweep deals 120. */
export const DIM_WEIGHT: Record<Dim, number> = { evidence: 3, consistency: 2.5, calibration: 2.5, actionability: 2, fit: 2 };
export const ARMOR_PER_SOURCE = 0.03;
export const ARMOR_MAX = 0.18;
/** The winner recovers this share of the health it lost before the next round. */
export const RECOVER = 0.3;

export const armor = (f: Facts | null): number => Math.min(ARMOR_MAX, Math.max(0, f?.cited ?? 0) * ARMOR_PER_SOURCE);

export interface Fighter {
  id: string;
  hp: number;
  /** Judged scores 0..10, or null when no judge answered: then the counted score stands in for every dimension. */
  dims: Record<Dim, number> | null;
  det: number;
  facts: Facts | null;
}
export interface Hit {
  dim: Dim;
  /** Who landed it. */
  by: "a" | "b";
  scoreA: number;
  scoreB: number;
  gap: number;
  raw: number;
  /** After armour. */
  dealt: number;
}
export interface DuelResult {
  hits: Hit[];
  hp: { a: number; b: number };
  /** Health before the exchange. */
  from: { a: number; b: number };
  armor: { a: number; b: number };
  winner: "a" | "b";
  ko: boolean;
  decidedBy: "ko" | "health" | "counted" | "seed";
  /** Damage taken, by fighter. */
  taken: { a: number; b: number };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Pure. One match. `a` wins an exact tie on health only after counted score, then seed order (a is the better seed). */
export function duel(a: Fighter, b: Fighter): DuelResult {
  const da = a.dims ?? (Object.fromEntries(DIMENSIONS.map((d) => [d, a.det])) as Record<Dim, number>);
  const db = b.dims ?? (Object.fromEntries(DIMENSIONS.map((d) => [d, b.det])) as Record<Dim, number>);
  const armA = armor(a.facts);
  const armB = armor(b.facts);
  const hits: Hit[] = [];
  let takenA = 0;
  let takenB = 0;
  for (const dim of DIMENSIONS) {
    const gap = r1(da[dim] - db[dim]);
    if (gap === 0) continue;
    const raw = r1(Math.abs(gap) * DIM_WEIGHT[dim]);
    const by = gap > 0 ? "a" : "b";
    const dealt = r1(raw * (1 - (by === "a" ? armB : armA)));
    hits.push({ dim, by, scoreA: da[dim], scoreB: db[dim], gap, raw, dealt });
    if (by === "a") takenB += dealt;
    else takenA += dealt;
  }
  const hpA = Math.max(0, r1(a.hp - takenA));
  const hpB = Math.max(0, r1(b.hp - takenB));
  let winner: "a" | "b";
  let decidedBy: DuelResult["decidedBy"];
  if (hpA !== hpB) { winner = hpA > hpB ? "a" : "b"; decidedBy = hpA === 0 || hpB === 0 ? "ko" : "health"; }
  else if (a.det !== b.det) { winner = a.det > b.det ? "a" : "b"; decidedBy = "counted"; }
  else { winner = "a"; decidedBy = "seed"; }
  return { hits, hp: { a: hpA, b: hpB }, from: { a: a.hp, b: b.hp }, armor: { a: armA, b: armB }, winner, ko: decidedBy === "ko", decidedBy, taken: { a: r1(takenA), b: r1(takenB) } };
}

/** Pure. Health carried into the next round: the winner recovers a share of what it lost. */
export const recover = (hp: number): number => r1(Math.min(MAX_HP, hp + (MAX_HP - hp) * RECOVER));

export interface Why {
  headline: string;
  winner: string[];
  loser: string[];
}
/** Pure. Words for a result, from the numbers in it: what the winner did, and what cost the loser. Only true statements; nothing is invented. */
export function whyResult(r: DuelResult, names: { a: string; b: string }): Why {
  const w = r.winner;
  const l = w === "a" ? "b" : "a";
  const [wn, ln] = [names[w], names[l]];
  const won = r.hits.filter((h) => h.by === w).sort((x, y) => y.dealt - x.dealt);
  const lost = r.hits.filter((h) => h.by === l).sort((x, y) => y.dealt - x.dealt);
  const how = r.decidedBy === "ko" ? "knocked out" : r.decidedBy === "health" ? "beat" : r.decidedBy === "counted" ? "edged out on counted evidence" : "advanced over";
  const headline = r.decidedBy === "seed" ? `${wn} advances: dead level, so the higher seed goes through.` : `${wn} ${how} ${ln}, ${r.hp[w]} health left against ${r.hp[l]}.`;
  const winner: string[] = [];
  if (won[0]) winner.push(`Hit hardest on ${won[0].dim}: ${w === "a" ? won[0].scoreA : won[0].scoreB} against ${w === "a" ? won[0].scoreB : won[0].scoreA}, ${won[0].dealt} damage.`);
  if (won.length > 1) winner.push(`Also ahead on ${won.slice(1).map((h) => h.dim).join(", ")}.`);
  if (r.armor[w] > 0) winner.push(`Cited sources worked as armour: ${Math.round(r.armor[w] * 100)}% less damage taken.`);
  if (!won.length) winner.push("Won with no hit landed: decided on counted evidence.");
  const loser: string[] = [];
  if (won[0]) loser.push(`Behind on ${won.map((h) => h.dim).join(", ")}; lost ${r.taken[l]} health.`);
  if (lost.length) loser.push(`Its best hit was ${lost[0].dim} (${lost[0].dealt} damage), not enough to make up the difference.`);
  if (r.armor[l] === 0) loser.push("No cited sources, so no armour.");
  return { headline, winner, loser };
}
