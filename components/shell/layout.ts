export type Side = "left" | "right";
export interface Limits { min: number; max: number; def: number }
export interface PanelPref { w: number; collapsed: boolean }

/** Sidebar on the left, artifact and chat panels on the right. */
export const LIMITS: Record<"sidebar" | "artifacts" | "dock", Limits> = {
  sidebar: { min: 216, max: 420, def: 272 },
  artifacts: { min: 360, max: 960, def: 640 },
  dock: { min: 340, max: 720, def: 440 },
};
export const RAIL_W = 44;
export const KEY_STEP = 24;

export const clampWidth = (w: number, l: Limits): number => Math.round(Math.min(l.max, Math.max(l.min, Number.isFinite(w) ? w : l.def)));

/**
 * Pure. The panel's size while its edge is dragged `dx` pixels. A panel on the left grows when dragged right; one on the right grows when
 * dragged left. Dragging well past the minimum snaps it shut (After Effects style); the remembered width is kept for when it reopens.
 */
export function dragPanel(start: PanelPref, dx: number, side: Side, l: Limits): PanelPref {
  const raw = start.collapsed ? RAIL_W + (side === "left" ? dx : -dx) : start.w + (side === "left" ? dx : -dx);
  if (raw < l.min * 0.6) return { w: start.w, collapsed: true };
  return { w: clampWidth(raw, l), collapsed: false };
}

/** Pure. Arrow keys on the focused handle: the arrow that points away from the panel grows it. */
export function keyPanel(p: PanelPref, key: string, side: Side, l: Limits): PanelPref | null {
  if (key === "Home") return { w: l.min, collapsed: false };
  if (key === "End") return { w: l.max, collapsed: false };
  if (key === "Enter") return { ...p, collapsed: !p.collapsed };
  const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
  const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
  if (key === grow) return { w: clampWidth(p.w + KEY_STEP, l), collapsed: false };
  if (key === shrink) return p.w - KEY_STEP < l.min ? { ...p, collapsed: true } : { w: p.w - KEY_STEP, collapsed: false };
  return null;
}

/** Pure. Reads a saved preference without trusting it. */
export function parsePref(raw: string | null, l: Limits): PanelPref {
  try {
    const j = JSON.parse(raw ?? "null") as Partial<PanelPref> | null;
    return { w: typeof j?.w === "number" ? clampWidth(j.w, l) : l.def, collapsed: j?.collapsed === true };
  } catch {
    return { w: l.def, collapsed: false };
  }
}
