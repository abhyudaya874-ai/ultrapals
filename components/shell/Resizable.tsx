"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { IconChevronRight } from "@/components/ui/icons";
import { LIMITS, dragPanel, keyPanel, parsePref, type PanelPref, type Side } from "./layout";

export interface Resizable {
  pref: PanelPref;
  width: number;
  collapsed: boolean;
  dragging: boolean;
  setCollapsed: (c: boolean) => void;
  /** Spread onto the `ResizeHandle`. */
  handle: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onDoubleClick: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  };
  /** CSS variable carrying the width, applied at the `lg` breakpoint only (small screens use drawers and overlays). */
  style: CSSProperties;
}

/**
 * A panel whose edge can be dragged, collapsed to a rail, and remembered between visits. While the edge is dragged the width is written straight
 * to a CSS variable on the page (`--pw-<name>`), so no component renders per pointer move; React hears about the new width once, when the drag
 * ends, or sooner if the panel snaps shut or open.
 */
export function useResizable(name: keyof typeof LIMITS, side: Side): Resizable {
  const l = LIMITS[name];
  const key = `sp-panel-${name}`;
  const rootVar = `--pw-${name}`;
  const [pref, setPref] = useState<PanelPref>({ w: l.def, collapsed: false });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; pref: PanelPref } | null>(null);
  const live = useRef<PanelPref | null>(null);
  const latest = useRef(pref);
  latest.current = pref;
  useEffect(() => {
    try { setPref(parsePref(localStorage.getItem(key), l)); } catch { /* defaults */ }
  }, [key, l]);
  const save = useCallback((p: PanelPref) => { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* not remembered */ } }, [key]);
  const set = useCallback((p: PanelPref) => { setPref(p); save(p); }, [save]);

  const finish = () => {
    const end = live.current ?? latest.current;
    start.current = null;
    live.current = null;
    setDragging(false);
    setPref(end);
    save(end);
    document.documentElement.style.removeProperty(rootVar);
  };

  return {
    pref,
    width: pref.w,
    collapsed: pref.collapsed,
    dragging,
    setCollapsed: (c) => set({ ...latest.current, collapsed: c }),
    handle: {
      onPointerDown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, pref: latest.current }; setDragging(true); },
      onPointerMove: (e) => {
        const s = start.current;
        if (!s) return;
        const next = dragPanel(s.pref, e.clientX - s.x, side, l);
        live.current = next;
        if (next.collapsed !== latest.current.collapsed) setPref(next); // snapping shut or open changes what is on screen: that one needs a render
        document.documentElement.style.setProperty(rootVar, `${next.w}px`);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onDoubleClick: () => set({ ...latest.current, collapsed: !latest.current.collapsed }),
      onKeyDown: (e) => { const n = keyPanel(latest.current, e.key, side, l); if (n) { e.preventDefault(); set(n); } },
    },
    style: { "--panel-w": `var(${rootVar}, ${pref.w}px)` } as CSSProperties,
  };
}

/** The draggable seam between two panels. Drag to resize, double-click or Enter to collapse, arrows to nudge. Hidden on small screens. */
export function ResizeHandle({ r, label, side }: { r: Resizable; label: string; side: Side }) {
  const l = side === "left" ? LIMITS.sidebar : LIMITS.artifacts;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={r.collapsed ? 0 : r.width}
      aria-valuemin={l.min}
      aria-valuemax={l.max}
      tabIndex={0}
      title="Drag to resize · double-click to collapse"
      data-testid={`resize-${label}`}
      {...r.handle}
      className="group relative z-20 hidden w-1 shrink-0 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:-inset-x-1.5 before:content-[''] lg:block"
    >
      <span className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all ${r.dragging ? "w-0.5 bg-accent" : "w-px bg-line group-hover:w-0.5 group-hover:bg-accent/80 group-focus-visible:w-0.5 group-focus-visible:bg-accent"}`} />
    </div>
  );
}

/** What a collapsed panel leaves behind: a thin rail with its title written vertically, like a docked panel in After Effects. */
export function Rail({ title, badge, onOpen, side }: { title: string; badge?: number; onOpen: () => void; side: Side }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${title}`}
      title={`Open ${title}`}
      data-testid={`rail-${title.toLowerCase()}`}
      className="group hidden w-11 shrink-0 flex-col items-center gap-3 bg-sidebar py-3 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:flex"
    >
      <IconChevronRight className={`size-4 transition-transform group-hover:translate-x-0.5 ${side === "right" ? "rotate-180 group-hover:-translate-x-0.5" : ""}`} />
      <span className="text-[11.5px] font-medium uppercase tracking-[0.18em] [writing-mode:vertical-rl]" style={{ transform: side === "right" ? "rotate(180deg)" : undefined }}>{title}</span>
      {badge ? <span className="grid min-w-5 place-items-center rounded-full bg-accent/20 px-1 text-[10.5px] text-accent">{badge}</span> : null}
    </button>
  );
}
