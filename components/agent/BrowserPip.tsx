"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconExpand, IconGlobe, IconX } from "@/components/ui/icons";
import { liveViewSrc } from "@/lib/browse/live-view";
import { hostOfUrl } from "@/lib/computer/visits";
import { useAgent } from "./AgentProvider";
import { clampOffset, recentBrowserActions } from "./pip-model";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;

/**
 * The live browser as a small floating player in the bottom-right corner, like a mini video: the real browser (every click and page load
 * happens in it), and under it a ticker of what the agent just did. Drag it by its top bar; expand it to take over the mouse.
 */
export function BrowserPip() {
  const { pip, setPip, liveViewUrl, page, runs, busy } = useAgent();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const src = useMemo(() => liveViewSrc(liveViewUrl, true), [liveViewUrl]);
  const [playing, setPlaying] = useState(false);
  const [control, setControl] = useState(false);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const actions = recentBrowserActions(runs, pip.expanded ? 6 : 3);

  useEffect(() => {
    setPlaying(false);
    setControl(false);
    if (!src) return;
    const origin = new URL(src).origin;
    const on = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      if (e.data?.type === "KERNEL_PLAYING") setPlaying(true);
      if (e.data?.type === "KERNEL_PAUSED") setPlaying(false);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [src]);
  // growing the player must not push it off screen
  useEffect(() => {
    const el = box.current;
    if (el) setOff((o) => clampOffset(o, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }));
  }, [pip.expanded, actions.length]);

  if (!pip.open || !src) return null;
  const toggleControl = () => {
    const next = !control;
    setControl(next);
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: !next, requestId: crypto.randomUUID() }, new URL(src).origin);
    if (next) frame.current?.focus();
  };
  const host = page ? hostOfUrl(page.url) : null;

  return (
    <div
      ref={box}
      role="complementary"
      aria-label="Live browser"
      data-testid="browser-pip"
      className={`fixed bottom-4 right-4 z-[60] overflow-hidden rounded-2xl border border-dock-line bg-surface shadow-[0_18px_60px_rgba(0,0,0,0.55)] transition-[width] duration-200 ${pip.expanded ? "w-[min(480px,calc(100vw-2rem))]" : "w-[236px]"}`}
      style={{ transform: `translate(${off.x}px, ${off.y}px)` }}
    >
      <div
        className="flex h-9 cursor-grab touch-none select-none items-center gap-1.5 border-b border-line bg-surface-2/80 pl-3 pr-1 active:cursor-grabbing"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = box.current;
          if (!d || !el) return;
          setOff(clampOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }));
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <span className={`size-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-bad" : "bg-fg-dim"}`} title={busy ? "Live" : "Idle"} />
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">{busy ? "Live" : "Browser"}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-dim" data-testid="pip-host">{host ?? "waiting for a page"}</span>
        <button type="button" onClick={() => setPip({ expanded: !pip.expanded })} aria-label={pip.expanded ? "Shrink the browser" : "Expand the browser"} title={pip.expanded ? "Shrink" : "Expand"} className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-line hover:text-fg"><IconExpand className="size-3.5" /></button>
        <button type="button" onClick={() => setPip({ open: false, expanded: false })} aria-label="Hide the browser" title="Hide" className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-line hover:text-fg"><IconX className="size-3.5" /></button>
      </div>
      <div className="relative aspect-[16/10] w-full bg-black">
        <iframe ref={frame} src={src} title="Live browser" allow="autoplay; clipboard-read; clipboard-write" className={`size-full ${pip.expanded ? "" : "pointer-events-none"}`} data-testid="live-view" />
        {!playing && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70 text-[12px] text-fg-muted">Connecting…</div>}
        {!pip.expanded && <button type="button" onClick={() => setPip({ expanded: true })} aria-label="Expand the browser" className="absolute inset-0 cursor-zoom-in" />}
      </div>
      <ul className="space-y-0.5 px-3 py-2" data-testid="pip-actions" aria-live="polite">
        {actions.length === 0 && <li className="flex items-center gap-2 text-[12px] text-fg-dim"><IconGlobe className="size-3.5 shrink-0" />{busy ? "Watching the page…" : "No browser actions yet"}</li>}
        {actions.map((a) => (
          <li key={a.id} className="rise flex items-center gap-2 text-[12px] text-fg-muted" title={a.detail ? `${a.label} — ${a.detail}` : a.label}>
            <span className={`size-1.5 shrink-0 rounded-full ${DOT[a.state]}`} />
            <span className="truncate">{a.label}</span>
          </li>
        ))}
      </ul>
      {pip.expanded && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim" data-testid="url-bar">{page?.url ?? "about:blank"}</span>
          <button type="button" onClick={toggleControl} aria-pressed={control} className="h-7 shrink-0 rounded-full border border-line bg-surface px-3 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg">{control ? "Give back control" : "Take over"}</button>
        </div>
      )}
    </div>
  );
}
