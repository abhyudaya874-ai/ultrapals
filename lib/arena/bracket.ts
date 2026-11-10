import { shuffled } from "./judge";

/**
 * A single-elimination bracket for up to 8 contenders. Sizes that are not a power of two get byes: the best seeds skip the first round, as in
 * a real tournament. Everything is derived from the ids and a seed string, so the bracket is the same on the server and in the browser.
 */
export interface Slot {
  /** The contender, or null while it is still to be decided (a later round). */
  id: string | null;
  /** Where the contender came from: a first-round seed, or "winner of <match>". */
  from: { seed: number } | { winnerOf: string } | { loserOf: string };
}
export interface Match {
  id: string;
  /** 1 = first round. The last round is the final. */
  round: number;
  /** Position within the round, top to bottom. */
  index: number;
  a: Slot;
  b: Slot;
  /** In round 1 only: one side has no opponent and goes through. */
  bye: boolean;
  /** "final", "semi", "quarter", "third" or "round-of-N" for labels. */
  label: string;
}
export interface Bracket {
  rounds: Match[][];
  /** Between the two semi-final losers, when there are at least 4 contenders. */
  third: Match | null;
  /** Seeds in order: seeds[0] is seed 1. */
  seeds: string[];
}

/** Pure. Standard seeding positions for a bracket of `size` (a power of two): [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function seedPositions(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order.slice(0, size);
}

const labelFor = (round: number, rounds: number): string => (round === rounds ? "Final" : round === rounds - 1 ? "Semi-final" : round === rounds - 2 ? "Quarter-final" : `Round ${round}`);

/** Pure. Builds the bracket for these contenders. The seeding is a deterministic shuffle of `ids` by `seed`. */
export function buildBracket(ids: readonly string[], seed: string): Bracket {
  const n = Math.max(2, Math.min(ids.length, 8));
  const seeds = shuffled(ids.slice(0, n), seed);
  let size = 2;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const pos = seedPositions(size);
  const out: Match[][] = [];
  const first: Match[] = [];
  for (let i = 0; i < size / 2; i++) {
    const [sa, sb] = [pos[i * 2], pos[i * 2 + 1]];
    const a: Slot = { id: sa <= n ? seeds[sa - 1] : null, from: { seed: sa } };
    const b: Slot = { id: sb <= n ? seeds[sb - 1] : null, from: { seed: sb } };
    first.push({ id: `r1m${i + 1}`, round: 1, index: i, a, b, bye: a.id === null || b.id === null, label: labelFor(1, rounds) });
  }
  out.push(first);
  for (let r = 2; r <= rounds; r++) {
    const prev = out[r - 2];
    const ms: Match[] = [];
    for (let i = 0; i < prev.length / 2; i++) {
      ms.push({ id: `r${r}m${i + 1}`, round: r, index: i, a: { id: null, from: { winnerOf: prev[i * 2].id } }, b: { id: null, from: { winnerOf: prev[i * 2 + 1].id } }, bye: false, label: labelFor(r, rounds) });
    }
    out.push(ms);
  }
  const semis = rounds >= 2 ? out[rounds - 2] : [];
  const third: Match | null = n >= 4 && semis.length === 2 ? { id: "third", round: rounds, index: 1, a: { id: null, from: { loserOf: semis[0].id } }, b: { id: null, from: { loserOf: semis[1].id } }, bye: false, label: "Third place" } : null;
  return { rounds: out, third, seeds };
}

export interface Result {
  matchId: string;
  winner: string;
}

/**
 * Pure. The bracket with every slot filled in from the results so far: byes advance their contender, winners move up, semi-final losers go to the
 * third-place match. A slot whose feeder match has no result yet stays null.
 */
export function resolve(bracket: Bracket, results: readonly Result[]): Bracket {
  const won = new Map(results.map((r) => [r.matchId, r.winner]));
  const lost = new Map<string, string>();
  const fill = (m: Match): Match => {
    const get = (s: Slot): string | null => {
      if (s.id) return s.id;
      if ("winnerOf" in s.from) return won.get(s.from.winnerOf) ?? null;
      if ("loserOf" in s.from) return lost.get(s.from.loserOf) ?? null;
      return null;
    };
    const a = { ...m.a, id: get(m.a) };
    const b = { ...m.b, id: get(m.b) };
    // a bye is decided by the bracket itself
    if (m.bye && !won.has(m.id)) {
      const only = a.id ?? b.id;
      if (only) won.set(m.id, only);
    }
    const loser = won.has(m.id) && a.id && b.id ? (won.get(m.id) === a.id ? b.id : a.id) : null;
    if (loser) lost.set(m.id, loser);
    return { ...m, a, b };
  };
  const rounds = bracket.rounds.map((r) => r.map(fill));
  return { ...bracket, rounds, third: bracket.third ? fill(bracket.third) : null };
}

/** Pure. The next match that has both contenders and no result yet, in playing order (round by round, third place with the final). */
export function nextMatch(bracket: Bracket, results: readonly Result[]): Match | null {
  const r = resolve(bracket, results);
  const done = new Set(results.map((x) => x.matchId));
  const all = [...r.rounds.flat(), ...(r.third ? [r.third] : [])].sort((x, y) => x.round - y.round || (x.id === "third" ? -1 : y.id === "third" ? 1 : x.index - y.index));
  return all.find((m) => !m.bye && m.a.id && m.b.id && !done.has(m.id)) ?? null;
}

/** Pure. Everyone's final standing from the results: champion, runner-up, then by how far they went. Ties keep seed order. */
export function standings(bracket: Bracket, results: readonly Result[], hp: Readonly<Record<string, number>> = {}): string[] {
  const r = resolve(bracket, results);
  const rounds = r.rounds.length;
  const reached = new Map<string, number>();
  for (const m of r.rounds.flat()) for (const s of [m.a.id, m.b.id]) if (s) reached.set(s, Math.max(reached.get(s) ?? 0, m.round));
  const final = r.rounds[rounds - 1]?.[0];
  const champ = final && results.find((x) => x.matchId === final.id)?.winner;
  const third = r.third && results.find((x) => x.matchId === r.third!.id)?.winner;
  const finalists = new Set([final?.a.id, final?.b.id].filter((x): x is string => !!x));
  const playedThird = new Set([r.third?.a.id, r.third?.b.id].filter((x): x is string => !!x));
  // champion, runner-up, third-place winner, fourth, then everyone else by how many rounds they won through
  const rank = (id: string) => (id === champ ? 1000 : finalists.has(id) ? 900 : id === third ? 800 : playedThird.has(id) ? 700 : (reached.get(id) ?? 0) * 10);
  return bracket.seeds.slice().sort((x, y) => rank(y) - rank(x) || (hp[y] ?? 0) - (hp[x] ?? 0) || bracket.seeds.indexOf(x) - bracket.seeds.indexOf(y));
}
