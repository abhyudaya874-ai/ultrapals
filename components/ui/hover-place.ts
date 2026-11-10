export interface Box { left: number; top: number; width: number; height: number }
export interface Spot {
  left: number;
  /** Exactly one of top or bottom is set: a card above its anchor hangs from the anchor's top edge, so its own height does not matter. */
  top?: number;
  bottom?: number;
  maxHeight: number;
  placed: "top" | "bottom" | "right" | "left";
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), Math.max(lo, hi));

/**
 * Pure. Where a card of width `w` goes next to the thing it explains, in viewport pixels. It prefers `side`, flips to the opposite side when
 * there is not room, and is pushed back inside the viewport. Its height is capped to the room it has.
 */
export function placeCard(anchor: Box, w: number, vp: { w: number; h: number }, side: "top" | "bottom" | "right", o: { gap?: number; margin?: number; hMax?: number } = {}): Spot {
  const gap = o.gap ?? 8;
  const margin = o.margin ?? 8;
  const hMax = o.hMax ?? 360;
  const above = anchor.top - margin - gap;
  const below = vp.h - (anchor.top + anchor.height) - margin - gap;
  if (side === "right") {
    const right = anchor.left + anchor.width + gap;
    const roomRight = vp.w - margin - right;
    const roomLeft = anchor.left - gap - margin;
    if (roomRight >= w || roomRight >= roomLeft) {
      const top = clamp(anchor.top, margin, vp.h - margin - 120);
      return { left: clamp(right, margin, vp.w - w - margin), top, maxHeight: Math.min(hMax, vp.h - top - margin), placed: "right" };
    }
    const top = clamp(anchor.top, margin, vp.h - margin - 120);
    return { left: clamp(anchor.left - gap - w, margin, vp.w - w - margin), top, maxHeight: Math.min(hMax, vp.h - top - margin), placed: "left" };
  }
  const left = clamp(anchor.left + anchor.width / 2 - w / 2, margin, vp.w - w - margin);
  const wantTop = side === "top";
  const useTop = wantTop ? above >= Math.min(hMax, 140) || above >= below : below < Math.min(hMax, 140) && above > below;
  return useTop
    ? { left, bottom: vp.h - anchor.top + gap, maxHeight: Math.max(80, Math.min(hMax, above)), placed: "top" }
    : { left, top: anchor.top + anchor.height + gap, maxHeight: Math.max(80, Math.min(hMax, below)), placed: "bottom" };
}
