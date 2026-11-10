/** Pure geometry for eyes drawn over a flat orb (the Thinking Orbs). Same model as the WebGL orb: two capsule eyes on a sphere that turns toward a point. */

export interface Look { x: number; y: number }
export interface Box { left: number; top: number; width: number; height: number }
export interface Eye { cx: number; cy: number; w: number; h: number; o: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const REST: Look = { x: 0, y: 0.08 };

/** Where to look, -1..1 on each axis (y up), for a pointer at (x, y) and an orb occupying `box`. */
export function lookAt(p: { x: number; y: number }, box: Box): Look {
  if (box.width <= 0 || box.height <= 0) return REST;
  return {
    x: clamp((p.x - (box.left + box.width / 2)) / (box.width / 2), -1, 1),
    y: clamp((box.top + box.height / 2 - p.y) / (box.height / 2), -1, 1),
  };
}

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** The same turn the shader applies: yaw by look.x, pitch by look.y. */
function orient(p: V3, look: Look): V3 {
  const yaw = look.x * 0.92;
  const pitch = -look.y * 0.78;
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const q: V3 = [p[0], p[1] * cp - p[2] * sp, p[1] * sp + p[2] * cp];
  return [q[0] * cy + q[2] * sy, q[1], -q[0] * sy + q[2] * cy];
}

/**
 * Pure. The two eyes inside a `size` x `size` box for a given look. `blink` is 0 (open) to 1 (closed). An eye that turns away from the viewer
 * narrows and fades (`o`), and one past the edge is invisible, as on a real sphere.
 */
export function eyeLayout(look: Look, size: number, blink = 0): [Eye, Eye] {
  const R = (size / 2) * 0.94;
  const c = size / 2;
  const half = 0.128 + (0.012 - 0.128) * blink;
  const rad = 0.054 + (0.062 - 0.054) * blink;
  const eye = (sx: number): Eye => {
    const e = orient(norm([sx * 0.32, 0.08, 1]), look);
    const facing = e[2];
    const o = clamp((facing - 0.12) / 0.2, 0, 1);
    return { cx: c + e[0] * R, cy: c - e[1] * R, w: 2 * rad * R * clamp(facing, 0.3, 1) * 1.15, h: 2 * (half + rad) * R, o };
  };
  return [eye(-1), eye(1)];
}

/** Pure. How long a blink lasts and its shape: closes fast, holds briefly, opens a little slower. t in seconds since the blink began. */
export function blinkAmount(t: number): number {
  if (t < 0) return 0;
  if (t < 0.055) return t / 0.055;
  if (t < 0.1) return 1;
  if (t < 0.18) return 1 - (t - 0.1) / 0.08;
  return 0;
}
