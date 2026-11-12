import { clampCount, type BattleBeat, type LoopBeat } from "@/lib/arena/preview";
import type { Pose } from "@/lib/arena/replay";
import { COUNTS, countHint, MODE_INFO, type ArenaMode } from "@/lib/arena/mode";

/**
 * The geometry of the home-screen preview (Battle and Loop). All pure: a count goes in, pixels come out, so the layout can be tested without a browser.
 */

export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The pop-in stagger: each orb appears this many ms after the one before it. */
export const POP_STAGGER_MS = 90;

/* ───────────────────────────── Battle ───────────────────────────── */

export interface BattleLayout {
  /** Orb diameter. */
  size: number;
  gap: number;
  /** Centre to centre between neighbours in the row. */
  pitch: number;
  /** The width of the row of orbs. */
  width: number;
  /** The width of the whole figure: at least the row, and wide enough for the fighters to stand apart on the stage above it. */
  box: number;
  /** Where the row starts inside the box. */
  offset: number;
  /** How far above its slot a fighter stands. */
  lift: number;
  /** Centre to centre between the two fighters when they stand apart. */
  arena: number;
  height: number;
}

/** Pure. How big the orbs are and how far apart, so that 2 to 6 of them fit the same space. */
export function battleLayout(n: number): BattleLayout {
  const count = clampCount(n);
  const size = count <= 3 ? 64 : count === 4 ? 60 : 52;
  const gap = 16;
  const pitch = size + gap;
  const width = count * pitch - gap;
  const arena = Math.round(Math.min(280, Math.max(190, width * 0.7)));
  const box = Math.max(width, arena + size);
  const lift = size + 14;
  return { size, gap, pitch, width, box, offset: (box - width) / 2, lift, arena, height: lift + size + 34 };
}

/** Pure. Left edge of slot `i` in the row. */
export const slotLeft = (l: BattleLayout, i: number): number => l.offset + i * l.pitch;

/** Pure. How far one fighter travels toward the other to touch: pose x = 1, the same meaning as in the real Duel. */
export const reachPx = (l: BattleLayout): number => (l.arena - l.size) / 2;

/** Pure. Left edge of a fighter's place on the stage, before it moves toward the middle. */
export const standLeft = (l: BattleLayout, side: "a" | "b"): number => (side === "a" ? (l.box - l.arena) / 2 - l.size / 2 : (l.box + l.arena) / 2 - l.size / 2);

/**
 * Pure. Where a fighter is, relative to its own slot, during one frame of its match. `move` takes it up onto the stage on its side and toward the middle
 * by the pose; `squash` flattens just the orb along the line of the hit (its label and health bar stay undistorted); a beaten fighter sinks a little.
 */
export function fighterPlace(l: BattleLayout, slot: number, side: "a" | "b", pose: Pose): { move: string; squash: string } {
  const dir = side === "a" ? 1 : -1;
  const dx = standLeft(l, side) - slotLeft(l, slot) + dir * reachPx(l) * pose.x;
  const dy = -l.lift + pose.down * 6;
  return { move: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`, squash: `scale(${pose.squash}, ${(1 + (1 - pose.squash) * 0.6).toFixed(3)})` };
}

/** Pure. Where, across the figure, the two touch on a hit: the attacker's far edge. Null when the frame is not a hit. */
export function contactLeft(l: BattleLayout, frame: BattleBeat["frame"]): number | null {
  const hit = frame?.hit;
  if (!frame || !hit) return null;
  return hit.by === "a" ? standLeft(l, "a") + l.size + reachPx(l) * frame.a.x : standLeft(l, "b") - reachPx(l) * frame.b.x;
}

export interface Look {
  opacity: number;
  /** 0 to 1: how grey. */
  gray: number;
  scale: number;
  /** The champion's ring. */
  glow: boolean;
}

/** Pure. How a team looks in a beat: everyone bright at the start, the two fighters bright and the others dimmed during a match, the beaten ones faded, the champion lit. */
export function teamLook(beat: BattleBeat, id: string, fighting: boolean, champion: string): Look {
  if (beat.kind === "crown" || beat.kind === "rest") return id === champion ? { opacity: 1, gray: 0, scale: 1.14, glow: true } : { opacity: 0.2, gray: 1, scale: 0.92, glow: false };
  if (!beat.alive.includes(id)) return { opacity: 0.2, gray: 1, scale: 0.92, glow: false };
  if (beat.kind === "frame" && !fighting) return { opacity: 0.5, gray: 0.2, scale: 0.96, glow: false };
  return { opacity: 1, gray: 0, scale: 1, glow: false };
}

/* ───────────────────────────── Loop ───────────────────────────── */

export interface LoopLayout {
  orb: number;
  /** The ring around an orb. */
  ring: number;
  pitch: number;
  width: number;
  /** Room above the rings for the baton that carries a weakness from one round to the next. */
  lane: number;
  /** Room under the rings for the round's label and its weakest measure. */
  labels: number;
  height: number;
}

/** Pure. Sizes for a chain of 2 to 6 rounds that fits the same space. */
export function loopLayout(n: number): LoopLayout {
  const count = clampCount(n);
  const orb = count <= 3 ? 52 : count === 4 ? 48 : count === 5 ? 44 : 40;
  const ring = orb + 18;
  const gap = count <= 4 ? 30 : 22;
  const pitch = ring + gap;
  const [lane, labels] = [22, 40];
  return { orb, ring, pitch, width: count * pitch - gap, lane, labels, height: lane + ring + labels };
}

/** Pure. Centre of round `i`'s ring (0-based), across the chain. */
export const ringCentre = (l: LoopLayout, i: number): number => i * l.pitch + l.ring / 2;

export interface Baton {
  /** Which orb it is at (0-based), or null when it is not shown. */
  at: number | null;
  /** The measure it is carrying to the next round. */
  carries: string | null;
}

/** Pure. Where the baton is: it leaves a round once that round's weakest measure is marked, carries it across, and is put down when the next orb starts to spin. */
export function baton(beat: LoopBeat, weakestOf: (round: number) => string): Baton {
  const none: Baton = { at: null, carries: null };
  if (beat.round === null) return none;
  if (beat.kind === "mark") return { at: beat.round - 1, carries: null };
  if (beat.kind === "pass") return { at: beat.round, carries: weakestOf(beat.round) };
  if (beat.kind === "aim") return { at: beat.round - 1, carries: weakestOf(beat.round - 1) };
  return none;
}

/** Pure. A point on a circle of radius `r` centred at (`c`, `c`), `deg` degrees clockwise from the top. */
export function polar(c: number, r: number, deg: number): { x: number; y: number } {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
}

/** Pure. One arc of the five-part ring, as an SVG path, from `from` to `to` degrees (0 is the top, clockwise). */
export function arcPath(c: number, r: number, from: number, to: number): string {
  const [a, b] = [polar(c, r, from), polar(c, r, to)];
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Pure. The five parts of the ring: where each starts and ends, in degrees, with a small gap between neighbours. */
export function segments(count = 5, gapDeg = 12): { from: number; to: number }[] {
  const span = 360 / count;
  return Array.from({ length: count }, (_, i) => ({ from: i * span + gapDeg / 2, to: (i + 1) * span - gapDeg / 2 }));
}

const tenths = (value: number): number => Math.max(0, Math.min(10, value)) / 10;

/** Pure. How much of its part of the ring a measure fills, as the dash offset of a path whose length is set to 1: 1 draws nothing and 0 draws all of it. */
export const fillOffset = (value: number): number => 1 - tenths(value);

/** Pure. The angle, on the ring, at which a measure of `value` (0 to 10) ends inside its part `part`. */
export function valueAngle(part: number, value: number): number {
  const s = segments()[part];
  return s.from + (s.to - s.from) * tenths(value);
}

/** Pure. A short line across the ring at `deg`, `half` either side of radius `r`: the mark that shows where the last round got to. */
export function tickPath(c: number, r: number, deg: number, half = 4.5): string {
  const [a, b] = [polar(c, r - half, deg), polar(c, r + half, deg)];
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export interface RoundLook {
  /** The ring is on: this round's five measures have been drawn. */
  drawn: boolean;
  /** This round's orb is the one turning. */
  spinning: boolean;
  /** The round has been told what to fix: the mark for the last round's value is on its ring. */
  aimed: boolean;
  /** Its weakest measure has been marked. */
  marked: boolean;
  /** Which part of the ring is calling for attention in this beat. */
  pulse: "aimed" | "weakest" | null;
  /** The best round, once the Loop has finished. */
  crowned: boolean;
  /** A round after the best one, which did not beat it. */
  spent: boolean;
}

/** Pure. How round `round` (counted from 1) looks in a beat. Each round goes aim, spin, mark in turn; once one is passed it stays as it was left. */
export function roundLook(beat: LoopBeat, round: number, bestRound: number): RoundLook {
  const ended = beat.kind === "crown" || beat.kind === "rest";
  const here = beat.round === round;
  const finished = ended || (beat.round !== null && round < beat.round);
  const reached = here && (beat.kind === "aim" || beat.kind === "spin" || beat.kind === "mark" || beat.kind === "pass");
  return {
    drawn: round <= beat.drawn,
    spinning: here && beat.kind === "spin",
    aimed: finished || reached,
    marked: finished || (here && (beat.kind === "mark" || beat.kind === "pass")),
    pulse: here && beat.kind === "aim" ? "aimed" : here && beat.kind === "mark" ? "weakest" : null,
    crowned: ended && round === bestRound,
    spent: ended && round > bestRound,
  };
}

/** The line under the figure: one line of 12px text, and the space above it. */
export const CAPTION_H = 24;

/** Pure. The height the figure always keeps for itself, whichever mode and count is picked: the tallest of them all. */
export const stageHeight = (): number => Math.max(...COUNTS.flatMap((n) => [battleLayout(n).height, loopLayout(n).height]));

/**
 * Pure. The height the whole preview always keeps: the figure and its caption. Switching between Battle and Loop, or between counts, then never
 * moves the title and the prompt box below it.
 */
export const castHeight = (): number => stageHeight() + CAPTION_H;

/* ───────────────────────────── The line under the preview ───────────────────────────── */

/** Pure. The title: UltraPal in chat, and the picked mode beside it in Battle and Loop. */
export const heroTitle = (mode: ArenaMode, name: string): string => (mode.kind === "chat" ? name : `${name} ${MODE_INFO[mode.kind].title}`);

/** Pure. The sentence under the title: in chat the normal line, in Battle and Loop what the mode does with the number that is picked. */
export function heroLine(mode: ArenaMode, chat: string): string {
  if (mode.kind === "chat") return chat;
  const hint = countHint(mode.kind, mode.n);
  if (mode.kind === "battle") return `${mode.n} teams argue opposite predictions, then a knockout picks the best-supported one: ${hint}.`;
  return mode.n === 2 ? `One team per round on a new scenario: ${hint}.` : `One team per round on a new scenario, ${hint}.`;
}
