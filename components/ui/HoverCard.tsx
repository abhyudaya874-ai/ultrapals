"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeCard, type Spot } from "./hover-place";

const CLOSE_MS = 110;

/**
 * Shows `card` next to `children` while the pointer is over either, or while the children have keyboard focus. The card is drawn in the page body, so
 * no scrolling panel can clip it, and it can be reached with the pointer (to select text or follow a link in it). Esc closes it.
 */
export function HoverCard({ card, children, width = 320, side = "top", className, label, maxHeight = 360 }: { card: ReactNode; children: ReactNode; width?: number; side?: "top" | "bottom" | "right"; className?: string; label?: string; maxHeight?: number }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const open = useCallback(() => {
    clearTimeout(timer.current);
    const r = root.current?.getBoundingClientRect();
    if (r) setSpot(placeCard({ left: r.left, top: r.top, width: r.width, height: r.height }, width, { w: window.innerWidth, h: window.innerHeight }, side, { hMax: maxHeight }));
  }, [width, side, maxHeight]);
  const close = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => setSpot(null), CLOSE_MS); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!spot) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") setSpot(null); };
    const off = () => setSpot(null);
    document.addEventListener("keydown", on);
    window.addEventListener("scroll", off, true); // a card left behind by a scroll would point at nothing
    return () => { document.removeEventListener("keydown", on); window.removeEventListener("scroll", off, true); };
  }, [spot]);
  return (
    <span ref={root} className={className ?? "inline-block"} onPointerEnter={open} onPointerLeave={close} onFocus={open} onBlur={close} aria-describedby={spot ? id : undefined} aria-label={label}>
      {children}
      {spot && typeof document !== "undefined" && createPortal(
        <div id={id} role="tooltip" onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={close}
          className={`${spot.placed === "bottom" ? "pop-in-down" : "pop-in"} fixed z-[80] overflow-y-auto rounded-xl border border-dock-line bg-surface p-3.5 shadow-2xl`}
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width, maxHeight: spot.maxHeight }}>
          {card}
        </div>,
        document.body,
      )}
    </span>
  );
}
