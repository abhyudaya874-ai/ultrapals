import type { DuelResult } from "./duel";
import { DIM_WEIGHT } from "./duel";
import type { Dim } from "./types";

/**
 * How a decided match is played back. The two orbs close in on each other; each hit that landed is one lunge, a touch and a recoil, in the order
 * of how hard it hit, with no pause between blows; then the loser settles back and the winner stays forward. Every number comes from the duel itself: the hits, the damage and
 * the health after each one. Pure, so the same match always plays the same way.
 */
export interface Pose {
  /** How far toward the middle, in units where 1 is halfway across the gap. Two orbs touch when their poses add up to 2. */
  x: number;
  /** 1 is round; below 1 is flattened along the line of the hit. */
  squash: number;
  /** 0 standing, 1 knocked out (faded and lowered). */
  down: number;
}
export interface Frame {
  /** What this moment is, for tests and for the caption. */
  kind: "intro" | "lunge" | "hit" | "recoil" | "rest" | "end";
  /** How long the move into this pose takes, in ms; the frame then holds for `hold`. */
  ms: number;
  hold: number;
  a: Pose;
  b: Pose;
  hp: { a: number; b: number };
  /** On a `hit` frame: who landed it, on what, and for how much. */
  hit?: { by: "a" | "b"; dim: Dim; dealt: number };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const stand: Pose = { x: 0, squash: 1, down: 0 };
const CLOSE = 0.7;
/** Pure. Total playing time in ms. */
export const replayMs = (frames: readonly Frame[]): number => frames.reduce((t, f) => t + f.ms + f.hold, 0);

/** Pure. The frames for one decided match, in playing order. The last frame's health is exactly the duel's final health. */
export function replay(d: DuelResult): Frame[] {
  const out: Frame[] = [];
  const hp = { ...d.from };
  const pose = (a: Partial<Pose>, b: Partial<Pose>) => ({ a: { ...stand, ...a }, b: { ...stand, ...b } });
  out.push({ kind: "intro", ms: 280, hold: 40, ...pose({ x: CLOSE }, { x: CLOSE }), hp: { ...hp } });
  const hits = [...d.hits].sort((x, y) => y.dealt - x.dealt || DIM_WEIGHT[y.dim] - DIM_WEIGHT[x.dim]);
  if (hits.length === 0) {
    // dead level: they touch, and bounce off each other
    out.push({ kind: "hit", ms: 170, hold: 50, ...pose({ x: 1, squash: 0.92 }, { x: 1, squash: 0.92 }), hp: { ...hp } });
    out.push({ kind: "rest", ms: 180, hold: 0, ...pose({ x: CLOSE }, { x: CLOSE }), hp: { ...hp } });
  }
  for (const h of hits) {
    const [att, def] = h.by === "a" ? (["a", "b"] as const) : (["b", "a"] as const);
    const at = (attacker: Partial<Pose>, defender: Partial<Pose>) => (att === "a" ? pose(attacker, defender) : pose(defender, attacker));
    out.push({ kind: "lunge", ms: 130, hold: 0, ...at({ x: 1.22 }, { x: 0.62 }), hp: { ...hp } });
    hp[def] = Math.max(0, r1(hp[def] - h.dealt));
    out.push({ kind: "hit", ms: 60, hold: 40, ...at({ x: 1.3, squash: 0.94 }, { x: 0.7, squash: 0.82 }), hp: { ...hp }, hit: { by: att, dim: h.dim, dealt: h.dealt } });
    out.push({ kind: "recoil", ms: 150, hold: 0, ...at({ x: 1.02 }, { x: 0.38 }), hp: { ...hp } });
  }
  const w = d.winner;
  const win: Partial<Pose> = { x: 0.9 };
  const lose: Partial<Pose> = d.ko ? { x: 0.35, down: 1 } : { x: 0.45, down: 0.4 };
  out.push({ kind: "end", ms: 300, hold: 0, ...(w === "a" ? pose(win, lose) : pose(lose, win)), hp: { ...d.hp } });
  return out;
}
