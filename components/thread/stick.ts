/** What a scroll box reports about itself. */
export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}
/** How far from the end still counts as "at the end" for a tall thread. A small box (a thinking stream) uses less. */
export const NEAR_END = 80;
export const NEAR_END_SMALL = 24;

/** Pure. Pixels left to scroll before the very end. */
export const pixelsToEnd = (m: ScrollMetrics): number => Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);

/** Pure. The reader has scrolled up: more than `slack` pixels sit below what they can see. */
export const awayFromEnd = (m: ScrollMetrics, slack: number = NEAR_END): boolean => pixelsToEnd(m) > slack;

/**
 * Pure. Whether the box should still follow new text after a scroll event.
 * Following stops only when the reader scrolls up, and starts again the moment they scroll back to the end.
 * A scroll that our own jump to the end caused is not the reader leaving: the text may have grown again between the jump and the event.
 */
export function nextAway(prev: boolean, m: ScrollMetrics, caused: boolean, slack: number = NEAR_END): boolean {
  return caused ? prev : awayFromEnd(m, slack);
}

/** Pure. Is a jump to the end worth making? (Not when the box is already there: that would raise a scroll event nobody asked for.) */
export const needsJump = (m: ScrollMetrics): boolean => pixelsToEnd(m) > 1;
