"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { anchorVisible, placeCard, sameSpot, type Spot } from "./hover-place";

const CLOSE_MS = 110;

/**
 * Shows `card` next to `children` while the pointer is over either, or while the children have keyboard focus. The card is drawn in the page body, so
 * no scrolling panel can clip it, and it can be reached with the pointer (to select text or follow a link in it).
 *
 * It stays open while the page moves under it. Streaming text scrolls the thread and grows the answer many times a second, so a scroll never closes the
 * card: it is placed again next to wherever its trigger now is. It closes when the pointer leaves (unless focus is still inside), on Esc, on a press
 * outside it, and when its trigger has scrolled out of sight.
 */
export function HoverCard({ card, children, width = 320, side = "top", className, label, maxHeight = 360 }: { card: ReactNode; children: ReactNode; width?: number; side?: "top" | "bottom" | "right"; className?: string; label?: string; maxHeight?: number }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  /** The pointer is on the trigger or on the card. A blur while it is does not close the card. */
  const over = useRef(false);
  const id = useId();
  const place = useCallback((): Spot | null => {
    const r = root.current?.getBoundingClientRect();
    if (!r) return null;
    return placeCard({ left: r.left, top: r.top, width: r.width, height: r.height }, width, { w: window.innerWidth, h: window.innerHeight }, side, { hMax: maxHeight });
  }, [width, side, maxHeight]);
  const open = useCallback(() => {
    clearTimeout(timer.current);
    const next = place();
    if (next) setSpot(next);
  }, [place]);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!over.current) setSpot(null); }, CLOSE_MS);
  }, []);
  /** Puts the card next to its trigger again (once per frame at most), or closes it when the trigger can no longer be seen. */
  const follow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = root.current?.getBoundingClientRect();
      if (!r || !anchorVisible({ left: r.left, top: r.top, width: r.width, height: r.height }, { w: window.innerWidth, h: window.innerHeight })) { setSpot(null); return; }
      const next = place();
      if (next) setSpot((cur) => (cur && sameSpot(cur, next) ? cur : next));
    });
  }, [place]);
  useEffect(() => () => { clearTimeout(timer.current); cancelAnimationFrame(frame.current); }, []);
  const shown = spot !== null;
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSpot(null); };
    const onPress = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && (root.current?.contains(t) || box.current?.contains(t))) return;
      over.current = false;
      setSpot(null);
    };
    // A scroll inside the card itself (it grows when a section opens) is not the page moving.
    const onScroll = (e: Event) => { if (e.target instanceof Node && box.current?.contains(e.target)) return; follow(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", follow);
    };
  }, [shown, follow]);
  // Every render of the owner (a new token, a new line of text above the trigger) can move the trigger without any scroll event, so look again after it.
  useEffect(() => { if (shown) follow(); });
  return (
    <span ref={root} className={className ?? "inline-block"} onPointerEnter={() => { over.current = true; open(); }} onPointerLeave={() => { over.current = false; close(); }} onFocus={open} onBlur={close} aria-describedby={spot ? id : undefined} aria-label={label}>
      {children}
      {spot && typeof document !== "undefined" && createPortal(
        <div ref={box} id={id} role="tooltip" onPointerEnter={() => { over.current = true; clearTimeout(timer.current); }} onPointerLeave={() => { over.current = false; close(); }}
          className={`${spot.placed === "bottom" ? "pop-in-down" : "pop-in"} fixed z-[80] overflow-y-auto rounded-xl border border-dock-line bg-surface p-3.5 shadow-2xl`}
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width, maxHeight: spot.maxHeight }}>
          {card}
        </div>,
        document.body,
      )}
    </span>
  );
}
