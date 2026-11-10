import type { RunState } from "@/lib/computer/events";
import type { Run } from "@/lib/computer/run";

export interface PipAction {
  id: string;
  label: string;
  state: RunState;
  detail?: string;
}

/**
 * Pure. The latest things the live browser did, for the corner player's ticker: every step of a BrowserPal, plus the "Opening <site> in the
 * browser" steps readers take. Newest last. Taken from the most recent run that used the browser, so an old run does not linger.
 */
export function recentBrowserActions(runs: readonly Run[], n: number): PipAction[] {
  for (let i = runs.length - 1; i >= 0; i--) {
    const acts = runs[i].agents.flatMap((a) => a.steps.filter((s) => a.role === "browser" || s.id.endsWith("-browser")).map((s): PipAction => ({ id: `${a.id}:${s.id}`, label: s.label, state: s.state, detail: s.detail })));
    if (acts.length) return acts.slice(-n);
  }
  return [];
}

/** Pure. Clamps a dragged offset so the player always stays fully inside the window (with `margin` px to spare). */
export function clampOffset(o: { x: number; y: number }, box: { w: number; h: number }, view: { w: number; h: number }, margin = 8): { x: number; y: number } {
  // the player rests at the bottom right: offsets are relative to that spot, so they can only move it left and up
  const minX = -(view.w - box.w - margin * 2);
  const minY = -(view.h - box.h - margin * 2);
  return { x: Math.min(0, Math.max(Math.min(0, minX), o.x)), y: Math.min(0, Math.max(Math.min(0, minY), o.y)) };
}
