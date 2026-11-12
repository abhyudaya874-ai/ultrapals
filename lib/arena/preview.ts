import { buildBracket, resolve, type Result } from "./bracket";
import { MAX_HP, duel, recover, type DuelResult, type Fighter } from "./duel";
import { contenderInfo, lineup } from "./personas";
import { MAX_SLOTS, MIN_SLOTS, defaultPlan } from "./plan";
import { replay, type Frame } from "./replay";
import { DIMENSIONS, type Dim, type Tool } from "./types";

/**
 * What the home screen shows when Battle or Loop is picked: the orbs that will take part, playing a short, repeatable preview of how the mode works.
 *
 * The preview is an illustration, not a result. No team has run and nobody has been judged, so the scores here are fixed stand-ins (a hash of the team
 * and the measure). Everything done with them is the real thing: the real bracket with its byes, the real `duel` arithmetic and the real `replay`
 * frames for a Battle; for a Loop, the real rule that each round is told to beat the weakest measure of the round before. All pure, so a given
 * count always plays the same way and a test can check every beat.
 */

/** Pure. A count as the mode menu offers it: a whole number from the smallest to the largest. */
export const clampCount = (n: number): number => Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, Math.round(Number.isFinite(n) ? n : MIN_SLOTS)));

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
};
const r1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Each team has one measure it is good at and one it is poor at, which is how teams with different personas differ. Any two of them therefore beat
 * each other somewhere, so every match trades blows both ways.
 */
const PROFILE: Record<string, { strong: Dim; weak: Dim }> = {
  maximalist: { strong: "evidence", weak: "fit" },
  skeptic: { strong: "consistency", weak: "evidence" },
  pragmatist: { strong: "actionability", weak: "calibration" },
  compliance: { strong: "calibration", weak: "actionability" },
  creative: { strong: "fit", weak: "consistency" },
  contrarian: { strong: "evidence", weak: "actionability" },
  rigorist: { strong: "calibration", weak: "fit" },
  cost: { strong: "actionability", weak: "evidence" },
};

/** Pure. A repeatable stand-in for one judge score, 2.0 to 9.8: a middling base, up for the team's strength, down for its weakness, and a little noise of its own. */
export const standIn = (team: string, dim: Dim): number => {
  const p = PROFILE[team];
  const noise = (hash(`${team}:${dim}`) - 0.5) * 1.2;
  return r1(Math.min(9.8, Math.max(2, 6 + (p?.strong === dim ? 3.2 : 0) - (p?.weak === dim ? 2.6 : 0) + noise)));
};

/* ───────────────────────────── Battle ───────────────────────────── */

export interface PreviewTeam {
  /** The persona's id: what the bracket and the stand-in scores are keyed by. */
  id: string;
  name: string;
  tool: Tool;
  /** The id a real Battle gives this team's orb, so the orb is drawn in the same colours here as there. */
  orb: string;
}
export interface PreviewMatch {
  id: string;
  /** "Semi-final", "Final" ... */
  label: string;
  /** The two teams. `a` stands to the left of `b` on screen. */
  a: string;
  b: string;
  duel: DuelResult;
  frames: Frame[];
  winner: string;
  loser: string;
  /** Everyone's health once the match is over (the winner has recovered a share of what it lost). */
  hpAfter: Record<string, number>;
}
/** What feeds one side of a bracket match: a team in the first round, or the winner of an earlier match. */
export type TreeFrom = { team: string } | { match: string };
/** One match of the bracket as a tree node, byes included. A bye has the one team that goes through as its only source. */
export interface TreeMatch {
  id: string;
  /** 1 = first round; the last round is the final. */
  round: number;
  index: number;
  /** "Quarter-final", "Semi-final", "Final". */
  label: string;
  bye: boolean;
  from: TreeFrom[];
}
export interface BattlePreview {
  teams: PreviewTeam[];
  /** Left to right as the teams stand: the bracket's first-round order, so the first opponents are neighbours. */
  order: string[];
  /** In playing order. Byes and the third-place match are left out. */
  matches: PreviewMatch[];
  /** The whole bracket, round by round (the third-place match is left out), for drawing it as a tree. */
  tree: TreeMatch[][];
  /** Teams that skip the first round. */
  byes: string[];
  champion: string;
}

function fighter(id: string, hp: number): Fighter {
  const dims = Object.fromEntries(DIMENSIONS.map((d) => [d, standIn(id, d)])) as Record<Dim, number>;
  const cited = 1 + Math.floor(hash(`${id}:cited`) * 5);
  return { id, hp, dims, det: r1(mean(Object.values(dims))), facts: { sources: cited + 4, cited, roles: [], files: 1, failed: false } };
}

/** Pure. `n` teams (2 to 6) through a real bracket, each match scored by the real duel. The same `n` always gives the same preview. */
export function battlePreview(n: number): BattlePreview {
  const count = clampCount(n);
  const teams: PreviewTeam[] = lineup(count).map((l, i) => ({ id: l.persona.id, name: l.persona.name, tool: l.tool, orb: contenderInfo(i, l).id }));
  const ids = teams.map((t) => t.id);
  const bracket = buildBracket(ids, "preview");
  const order = bracket.rounds[0].flatMap((m) => [m.a.id, m.b.id]).filter((x): x is string => x !== null);
  const byes = bracket.rounds[0].filter((m) => m.bye).flatMap((m) => [m.a.id ?? m.b.id]).filter((x): x is string => x !== null);
  const hp: Record<string, number> = Object.fromEntries(ids.map((id) => [id, MAX_HP]));
  const results: Result[] = [];
  const matches: PreviewMatch[] = [];
  for (const round of bracket.rounds) {
    for (const m of round) {
      const here = resolve(bracket, results).rounds[m.round - 1][m.index];
      if (here.bye || !here.a.id || !here.b.id) continue; // a bye is decided by the bracket itself
      const [a, b] = [here.a.id, here.b.id];
      const d = duel(fighter(a, hp[a]), fighter(b, hp[b]));
      const winner = d.winner === "a" ? a : b;
      const loser = winner === a ? b : a;
      hp[a] = d.hp.a;
      hp[b] = d.hp.b;
      hp[winner] = recover(hp[winner]);
      results.push({ matchId: m.id, winner });
      matches.push({ id: m.id, label: m.label, a, b, duel: d, frames: replay(d), winner, loser, hpAfter: { ...hp } });
    }
  }
  const last = matches[matches.length - 1];
  const tree: TreeMatch[][] = bracket.rounds.map((round) => round.map((m) => ({
    id: m.id, round: m.round, index: m.index, label: m.label, bye: m.bye,
    from: [m.a, m.b].flatMap((s): TreeFrom[] => (s.id ? [{ team: s.id }] : "winnerOf" in s.from ? [{ match: s.from.winnerOf }] : [])),
  })));
  return { teams, order, matches, tree, byes, champion: last.winner };
}

export interface BattleBeat {
  kind: "gather" | "frame" | "crown" | "rest";
  /** Index into `matches` while a match is on. */
  match: number | null;
  /** The two fighters' poses during a `frame` beat. */
  frame: Frame | null;
  /** How long the move into this beat takes, then how long it holds (ms). */
  ms: number;
  hold: number;
  /** Teams still in the knockout during this beat. A team that has lost is not in it. */
  alive: string[];
  /** The bracket matches that have a winner by now, with who it is. Byes are decided from the start. */
  decided: Record<string, string>;
  /** The bracket match being played in this beat. */
  live: string | null;
  /** The health each team shows. */
  hp: Record<string, number>;
  /** One line saying what is happening. */
  caption: string;
}

/** Pure. The whole preview as a list of beats to play in order, then start over. */
export function battleTape(p: BattlePreview): BattleBeat[] {
  const name = (id: string): string => p.teams.find((t) => t.id === id)?.name ?? id;
  const tape: BattleBeat[] = [];
  const hp: Record<string, number> = Object.fromEntries(p.teams.map((t) => [t.id, MAX_HP]));
  let alive = p.teams.map((t) => t.id);
  // a bye is decided by the bracket itself, so its team is through from the first beat
  const decided: Record<string, string> = Object.fromEntries(p.tree.flat().filter((m) => m.bye).map((m) => [m.id, (m.from[0] as { team: string }).team]));
  tape.push({ kind: "gather", match: null, frame: null, ms: 0, hold: 900, alive: [...alive], decided: { ...decided }, live: null, hp: { ...hp }, caption: `${p.teams.length} teams, ${p.teams.length} opposite predictions` });
  p.matches.forEach((m, i) => {
    const [na, nb] = [name(m.a), name(m.b)];
    for (const f of m.frames) {
      const shown: Record<string, number> = { ...hp, [m.a]: f.hp.a, [m.b]: f.hp.b };
      const caption = f.hit
        ? `${f.hit.by === "a" ? na : nb} hits ${f.hit.by === "a" ? nb : na} on ${f.hit.dim} (${f.hit.dealt.toFixed(1)})`
        : f.kind === "end" ? `${name(m.winner)} wins${m.duel.ko ? " by knockout" : ""}` : `${m.label}: ${na} against ${nb}`;
      // the winner is through the moment the match is over, while the loser is still sinking
      tape.push({ kind: "frame", match: i, frame: f, ms: f.ms, hold: f.hold, alive: [...alive], decided: f.kind === "end" ? { ...decided, [m.id]: m.winner } : { ...decided }, live: m.id, hp: shown, caption });
    }
    decided[m.id] = m.winner;
    Object.assign(hp, m.hpAfter);
    alive = alive.filter((id) => id !== m.loser);
  });
  tape.push({ kind: "crown", match: null, frame: null, ms: 420, hold: 1300, alive: [p.champion], decided: { ...decided }, live: null, hp: { ...hp }, caption: `${name(p.champion)} takes the knockout` });
  tape.push({ kind: "rest", match: null, frame: null, ms: 0, hold: 1500, alive: [p.champion], decided: { ...decided }, live: null, hp: { ...hp }, caption: "In a real Battle, live teams run and a blind judge scores their reports" });
  return tape;
}

/* ───────────────────────────── Loop ───────────────────────────── */

export interface RoundPreview {
  round: number;
  /** The id a real Loop gives this round's orb, and the tool it starts with, taken from the Loop's own default plan. */
  orb: string;
  tool: Tool;
  /** The five measures, 0 to 10. */
  dims: Record<Dim, number>;
  /** The mean of the five, one decimal. */
  score: number;
  /** The lowest measure: what the next round is told to fix. */
  weakest: Dim;
  /** What this round was told to fix (the round before's weakest); null for the first round. */
  aimed: Dim | null;
  /** Score minus the previous round's. */
  delta: number | null;
  /** The best round of the preview. */
  best: boolean;
}
export interface LoopPreview {
  rounds: RoundPreview[];
  /** The round number of the best round. */
  bestRound: number;
  /** "held": a score of 8 or more that the next round did not beat. "limit": it ran out of rounds. */
  stop: "held" | "limit";
}

const START: Record<Dim, number> = { evidence: 4.4, consistency: 7.4, calibration: 5.3, actionability: 6.8, fit: 5.9 };
/** How far the measure a round was told to fix rises, by round number (index 1 is round 2). The other four drift up a little. */
const LIFT = [0, 2.4, 2.1, 1.8, 1.5, 1.2];
const DRIFT = 0.2;
const CEIL = 9.6;

const weakestOf = (d: Record<Dim, number>): Dim => DIMENSIONS.reduce((w, k) => (d[k] < d[w] ? k : w), DIMENSIONS[0]);

/** Pure. `n` rounds (2 to 6) of a Loop: each is told to fix the weakest measure of the round before, so the score climbs and slows down. */
export function loopPreview(n: number): LoopPreview {
  const count = clampCount(n);
  const slots = defaultPlan("loop", count, { question: "preview" }).slots;
  const rounds: RoundPreview[] = [];
  let dims = { ...START };
  for (let r = 1; r <= count; r++) {
    const aimed = r === 1 ? null : rounds[r - 2].weakest;
    if (r > 1) {
      const next = {} as Record<Dim, number>;
      // the last round of a six-round Loop fixes one thing and breaks others: the best stays where it was, and the Loop stops there
      const regress = count === 6 && r === 6;
      for (const d of DIMENSIONS) next[d] = Math.min(CEIL, r1(dims[d] + (d === aimed ? (regress ? 0.6 : LIFT[r - 1]) : regress ? -0.35 : DRIFT)));
      dims = next;
    }
    const score = r1(mean(Object.values(dims)));
    rounds.push({ round: r, orb: `r${r}-${slots[r - 1].persona}`, tool: slots[r - 1].tool, dims: { ...dims }, score, weakest: weakestOf(dims), aimed, delta: r === 1 ? null : r1(score - rounds[r - 2].score), best: false });
  }
  const top = rounds.reduce((b, x) => (x.score > b.score ? x : b), rounds[0]);
  top.best = true;
  const stop = top.score >= 8 && top.round < count ? "held" : "limit";
  return { rounds, bestRound: top.round, stop };
}

export interface LoopBeat {
  kind: "gather" | "aim" | "spin" | "mark" | "pass" | "crown" | "rest";
  /** The round this beat is about. */
  round: number | null;
  ms: number;
  hold: number;
  /** How many rounds have drawn their rings so far (the spinning round counts as soon as it spins). */
  drawn: number;
  caption: string;
}

const aimLine = (round: number, aimed: Dim): string => `Round ${round} must beat round ${round - 1} on ${aimed}`;

/** Pure. The whole preview as beats: for each round, aim at the weakness, spin once while the ring draws, mark the weakest, pass the baton. */
export function loopTape(p: LoopPreview): LoopBeat[] {
  const tape: LoopBeat[] = [];
  const n = p.rounds.length;
  tape.push({ kind: "gather", round: null, ms: 0, hold: 900, drawn: 0, caption: `${n} rounds, one after another` });
  p.rounds.forEach((r, i) => {
    if (r.aimed) tape.push({ kind: "aim", round: r.round, ms: 320, hold: 450, drawn: i, caption: aimLine(r.round, r.aimed) });
    tape.push({ kind: "spin", round: r.round, ms: 1000, hold: 150, drawn: i + 1, caption: r.delta === null ? `Round 1 scores ${r.score.toFixed(1)}: the base case` : `Round ${r.round} scores ${r.score.toFixed(1)} (${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)})` });
    tape.push({ kind: "mark", round: r.round, ms: 420, hold: 480, drawn: i + 1, caption: `Round ${r.round}'s weakest measure is ${r.weakest}` });
    // the baton is carried over while the next round's aim is already on screen, so the sentence is the same and does not flicker
    if (i < n - 1) tape.push({ kind: "pass", round: r.round, ms: 460, hold: 0, drawn: i + 1, caption: aimLine(r.round + 1, r.weakest) });
  });
  const best = p.rounds[p.bestRound - 1];
  tape.push({ kind: "crown", round: p.bestRound, ms: 500, hold: 1200, drawn: n, caption: p.stop === "held" ? `Round ${best.round} scored ${best.score.toFixed(1)} and the next did not beat it, so the Loop stops` : `Round ${best.round} is the best of ${n}: ${best.score.toFixed(1)}` });
  tape.push({ kind: "rest", round: p.bestRound, ms: 0, hold: 1400, drawn: n, caption: "In a real Loop a team runs each round and a blind judge scores it" });
  return tape;
}

/** Pure. How long a tape takes to play once, in ms. */
export const tapeMs = (tape: readonly { ms: number; hold: number }[]): number => tape.reduce((t, b) => t + b.ms + b.hold, 0);
