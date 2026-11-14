export interface PopoverFit {
  /** Which side of the button the popover opens on. */
  side: "above" | "below";
  /** The tallest it may be on that side without leaving the window; taller content scrolls inside it. */
  maxHeight: number;
}

/** The least room a popover is worth opening in: a short list that scrolls beats one that is cut off. */
export const MIN_POPOVER_HEIGHT = 160;

/**
 * Pure. Where a popover hangs from its button so that all of it stays inside the window. It opens above the button (the usual place for the prompt
 * box, which sits low) when it fits there, below when it only fits there, and otherwise on whichever side has more room, with its height capped to
 * that room. `want` is how tall it would like to be; `gap` is the space between button and popover; `margin` is what to leave at the window edge.
 */
export function fitPopover(o: { anchorTop: number; anchorBottom: number; viewportH: number; want: number; gap?: number; margin?: number }): PopoverFit {
  const gap = o.gap ?? 8;
  const margin = o.margin ?? 12;
  const above = o.anchorTop - gap - margin;
  const below = o.viewportH - o.anchorBottom - gap - margin;
  const side = o.want <= above ? "above" : o.want <= below ? "below" : above >= below ? "above" : "below";
  const room = side === "above" ? above : below;
  return { side, maxHeight: Math.max(MIN_POPOVER_HEIGHT, Math.floor(Math.min(room, Math.max(o.want, MIN_POPOVER_HEIGHT)))) };
}
