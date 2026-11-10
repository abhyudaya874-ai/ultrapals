"use client";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { columnsFor, dividerAt, dragSplit, evenWeights, pxToWeight, rowsFor, swap, syncOrder } from "./board";

export interface PanelHooks {
  /** Spread on the part of the panel you grab to move it. */
  grab: { draggable: true; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };
  focused: boolean;
  toggleFocus: () => void;
}

/**
 * Panels in a grid that you can reshape: drag a divider to give one panel more room, drag a panel by its title onto another to swap them, or
 * focus one to fill the board. While a divider moves, the grid is written directly (no component renders per pointer move), and the sizes
 * are saved once the pointer is released.
 */
export function PanelBoard({ ids, render }: { ids: string[]; render: (id: string, hooks: PanelHooks) => ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cuts = useRef(new Map<string, HTMLElement>());
  const live = useRef<{ axis: "c" | "r"; i: number; start: number; from: number[]; now: number[] } | null>(null);
  const [width, setWidth] = useState(1200);
  const [order, setOrder] = useState<string[]>([]);
  const [sizes, setSizes] = useState<{ c: number[]; r: number[] }>({ c: [], r: [] });
  const [focus, setFocus] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = syncOrder(order, ids);
  const cols = columnsFor(shown.length, width);
  const rows = rowsFor(shown.length, cols);
  const colW = sizes.c.length === cols ? sizes.c : evenWeights(cols);
  const rowH = sizes.r.length === rows ? sizes.r : evenWeights(rows);
  const focusId = focus && shown.includes(focus) ? focus : null;

  const paint = (axis: "c" | "r", w: number[]) => {
    const g = grid.current;
    if (g) g.style[axis === "c" ? "gridTemplateColumns" : "gridTemplateRows"] = w.map((x) => `${x}fr`).join(" ");
    dividerAt(w).forEach((p, i) => { const el = cuts.current.get(`${axis}${i}`); if (el) el.style[axis === "c" ? "left" : "top"] = `${p * 100}%`; });
  };
  const down = (axis: "c" | "r", i: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = axis === "c" ? colW : rowH;
    live.current = { axis, i, start: axis === "c" ? e.clientX : e.clientY, from, now: from };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = live.current;
    const box = grid.current?.getBoundingClientRect();
    if (!d || !box) return;
    const px = (d.axis === "c" ? e.clientX : e.clientY) - d.start;
    const total = d.from.reduce((a, b) => a + b, 0);
    d.now = dragSplit(d.from, d.i, pxToWeight(px, total, d.axis === "c" ? box.width : box.height));
    paint(d.axis, d.now);
  };
  const up = () => {
    const d = live.current;
    live.current = null;
    if (d) setSizes({ c: d.axis === "c" ? d.now : colW, r: d.axis === "r" ? d.now : rowH });
  };
  const nudge = (axis: "c" | "r", i: number) => (e: KeyboardEvent) => {
    const grow = axis === "c" ? "ArrowRight" : "ArrowDown";
    const shrink = axis === "c" ? "ArrowLeft" : "ArrowUp";
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const w = dragSplit(axis === "c" ? colW : rowH, i, e.key === grow ? 0.1 : -0.1);
    setSizes({ c: axis === "c" ? w : colW, r: axis === "r" ? w : rowH });
  };
  const drop = (target: string) => {
    if (drag && drag !== target) setOrder(swap(shown, drag, target));
    setDrag(null);
    setOver(null);
  };

  const cell = (id: string, solo: boolean) => (
    <div key={id} className={`min-h-0 min-w-0 p-1.5 transition-opacity ${drag === id ? "opacity-50" : ""}`} data-testid="panel-cell"
      onDragOver={(e) => { if (drag) { e.preventDefault(); if (over !== id) setOver(id); } }} onDragLeave={() => setOver((o) => (o === id ? null : o))} onDrop={(e) => { e.preventDefault(); drop(id); }}>
      <div className={`size-full rounded-2xl transition-shadow ${over === id && drag !== id ? "shadow-[0_0_0_1px_var(--color-accent)]" : ""}`}>
        {render(id, {
          grab: { draggable: true, onDragStart: (e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; setDrag(id); }, onDragEnd: () => { setDrag(null); setOver(null); } },
          focused: solo,
          toggleFocus: () => setFocus(solo ? null : id),
        })}
      </div>
    </div>
  );

  return (
    <div ref={outer} className="size-full" data-testid="panel-board">
      {focusId ? <div className="size-full">{cell(focusId, true)}</div> : (
        <div ref={grid} className="relative grid size-full" style={{ gridTemplateColumns: colW.map((w) => `${w}fr`).join(" "), gridTemplateRows: rowH.map((w) => `${w}fr`).join(" ") }}>
          {shown.map((id) => cell(id, false))}
          {dividerAt(colW).map((p, i) => (
            <div key={`c${i}`} ref={(el) => { if (el) cuts.current.set(`c${i}`, el); else cuts.current.delete(`c${i}`); }} role="separator" aria-orientation="vertical" aria-label="Resize panels" tabIndex={0}
              onPointerDown={down("c", i)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={nudge("c", i)}
              className="group absolute inset-y-3 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none md:block" style={{ left: `${p * 100}%` }}>
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent group-active:bg-accent" />
            </div>
          ))}
          {dividerAt(rowH).map((p, i) => (
            <div key={`r${i}`} ref={(el) => { if (el) cuts.current.set(`r${i}`, el); else cuts.current.delete(`r${i}`); }} role="separator" aria-orientation="horizontal" aria-label="Resize panels" tabIndex={0}
              onPointerDown={down("r", i)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={nudge("r", i)}
              className="group absolute inset-x-3 z-10 hidden h-3 -translate-y-1/2 cursor-row-resize touch-none outline-none md:block" style={{ top: `${p * 100}%` }}>
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent group-active:bg-accent" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
