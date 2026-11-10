"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { IconExpand, IconX } from "@/components/ui/icons";
import { liveViewSrc } from "@/lib/browse/live-view";
import type { BrowserState } from "@/lib/integrations/kbrowser";
import { useAgent } from "./AgentProvider";
import { AddressBar, AgentBox } from "./BrowserBar";
import { browserGet, browserPost, hostLabel, type BrowserOp, type BrowserReply } from "./browser-client";
import { START, WATCHDOG_MS, clampOffset, nextView, recentBrowserActions, shouldAutoRetry, viewNote } from "./pip-model";

const DOT = { running: "bg-warn animate-pulse", ok: "bg-ok", error: "bg-bad" } as const;
/** How often the window asks the server where the browser is: often while it is big and being used, rarely while it is a small corner player. */
const POLL_OPEN_MS = 2500;
const POLL_SMALL_MS = 30_000;

/**
 * The live browser in a window at the bottom right. Small, it is a player with a ticker of what the agent just did. Expanded, it is a browser:
 * back, forward, reload, an address bar that takes an address or search words, a button to take the mouse and keyboard, and a box to tell the
 * agent what to do on the page that is open. Drag it by its top bar.
 *
 * The view can fail quietly (Kernel's viewer says nothing when its browser has been deleted), so it is watched: no video within a minute is a
 * failure, a failure retries once, and the server is asked whether the browser still exists so a closed one says so and offers a new one.
 */
export function BrowserPip() {
  const { pip, setPip, liveViewUrl, sessionId, adoptBrowser, page, runs, busy, send, stop, handoff } = useAgent();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const src = useMemo(() => liveViewSrc(liveViewUrl, true), [liveViewUrl]);
  const [view, dispatch] = useReducer(nextView, START);
  const [attempt, setAttempt] = useState(0);
  const [control, setControl] = useState(false);
  const [state, setState] = useState<BrowserState | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const actions = recentBrowserActions(runs, pip.expanded ? 6 : 3);
  const open = pip.open && !!src;

  const apply = useCallback((r: BrowserReply) => {
    if (!r.alive) dispatch({ t: "server", alive: false });
    if (r.state) setState(r.state);
  }, []);

  // a new browser (a different live view address) starts over
  useEffect(() => {
    dispatch({ t: "reset" });
    setAttempt(0);
    setControl(false);
    setState(null);
    setNavError(null);
  }, [src]);

  // the viewer's own messages
  useEffect(() => {
    if (!src) return;
    const origin = new URL(src).origin;
    const on = (e: MessageEvent) => {
      if (e.origin !== origin || typeof e.data?.type !== "string") return;
      dispatch({ t: "message", type: e.data.type, reason: typeof e.data.reason === "string" ? e.data.reason : undefined });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [src]);

  // silence is not "still connecting"
  useEffect(() => {
    if (!open || view.kind !== "connecting") return;
    const t = setTimeout(() => dispatch({ t: "watchdog" }), WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [open, view, attempt]);

  // one automatic reconnect, then the person decides; and a failure is the moment to ask whether the browser still exists
  useEffect(() => {
    if (view.kind !== "failed") return;
    if (sessionId) void browserGet(sessionId).then(apply);
    if (shouldAutoRetry(view)) {
      const t = setTimeout(() => { dispatch({ t: "retry" }); setAttempt((a) => a + 1); }, 1200);
      return () => clearTimeout(t);
    }
  }, [view, sessionId, apply]);

  // where the browser is (address, title, whether back and forward can go), and whether it still exists
  useEffect(() => {
    if (!open || !sessionId || view.kind === "closed") return;
    let live = true;
    const ask = () => { if (!document.hidden) void browserGet(sessionId).then((r) => live && apply(r)); };
    ask();
    const t = setInterval(ask, pip.expanded ? POLL_OPEN_MS : POLL_SMALL_MS);
    return () => { live = false; clearInterval(t); };
  }, [open, sessionId, pip.expanded, view.kind, apply]);

  // growing the player must not push it off screen
  useEffect(() => {
    const el = box.current;
    if (el) setOff((o) => clampOffset(o, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }));
  }, [pip.expanded, actions.length, view.kind, navError]);

  const nav = useCallback(async (op: BrowserOp) => {
    if (!sessionId || navBusy) return;
    setNavBusy(true);
    setNavError(null);
    const r = await browserPost(sessionId, op);
    apply(r);
    if (r.ok === false && r.alive && r.error) setNavError(r.error);
    setNavBusy(false);
  }, [sessionId, navBusy, apply]);

  const openNew = useCallback(async () => {
    if (!sessionId || opening) return;
    setOpening(true);
    const r = await browserPost(sessionId, { op: "open" });
    setOpening(false);
    if (r.ok && r.liveViewUrl) adoptBrowser(r.liveViewUrl);
    else setNavError(r.error ?? "Could not start a browser.");
  }, [sessionId, opening, adoptBrowser]);

  // When the agent asks for the person, the browser is theirs: switch to take-over as soon as the video is up, once per request.
  const handoffKey = handoff ? `${handoff.agent}|${handoff.reason}|${handoff.url}` : "";
  const handled = useRef("");
  useEffect(() => {
    if (!handoffKey || view.kind !== "playing" || handled.current === handoffKey || !src) return;
    handled.current = handoffKey;
    setControl(true);
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: false, requestId: crypto.randomUUID() }, new URL(src).origin);
    frame.current?.focus();
  }, [handoffKey, view.kind, src]);

  if (!open || !src) return null;

  const takeOver = (next: boolean) => {
    setControl(next);
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: !next, requestId: crypto.randomUUID() }, new URL(src).origin);
    if (next) frame.current?.focus();
  };
  const toggleControl = () => takeOver(!control);
  const url = state?.url ?? page?.url ?? "";
  const host = hostLabel(url);
  const note = viewNote(view);
  const playing = view.kind === "playing";
  const showFrame = view.kind === "connecting" || view.kind === "playing";
  const dead = view.kind === "closed";

  return (
    <div
      ref={box}
      role="complementary"
      aria-label="Live browser"
      data-testid="browser-pip"
      data-view={view.kind}
      className={`fixed bottom-4 right-4 z-[60] overflow-hidden rounded-2xl border border-dock-line bg-surface shadow-[0_18px_60px_rgba(0,0,0,0.55)] transition-[width] duration-[160ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${pip.expanded ? "w-[min(820px,calc(100vw-2rem),calc((100dvh-260px)*1.6))] min-w-[min(420px,calc(100vw-2rem))]" : "w-[236px]"}`}
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
        <span className={`size-2 shrink-0 rounded-full ${dead ? "bg-bad" : busy ? "animate-pulse bg-bad" : playing ? "bg-ok" : "bg-fg-dim"}`} title={dead ? "Closed" : busy ? "The agent is working" : playing ? "Live" : "Not connected"} />
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">{dead ? "Closed" : busy ? "Live" : "Browser"}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-dim" data-testid="pip-host">{host || "waiting for a page"}</span>
        <button type="button" onClick={() => setPip({ expanded: !pip.expanded })} aria-label={pip.expanded ? "Shrink the browser" : "Expand the browser"} title={pip.expanded ? "Shrink" : "Expand"} className="press grid size-7 place-items-center rounded-md text-fg-muted hover:bg-line hover:text-fg"><IconExpand className="size-3.5" /></button>
        <button type="button" onClick={() => setPip({ open: false, expanded: false })} aria-label="Hide the browser" title="Hide" className="press grid size-7 place-items-center rounded-md text-fg-muted hover:bg-line hover:text-fg"><IconX className="size-3.5" /></button>
      </div>

      {handoff && (
        <div className="flex items-start gap-3 border-b border-line border-l-2 border-l-warn bg-warn/[0.06] px-3 py-2.5" role="alert" data-testid="handoff-banner">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-fg">Needs you</p>
            <p className="text-[12.5px] leading-snug text-fg-muted">{handoff.reason}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => { takeOver(false); void send("continue"); }} className="press h-7 shrink-0 rounded-full bg-fg px-3 text-[12px] font-medium text-canvas hover:bg-white disabled:opacity-50">Done, continue</button>
        </div>
      )}

      {pip.expanded && (
        <AddressBar url={url} canBack={state?.canBack ?? false} canForward={state?.canForward ?? false} loading={navBusy} disabled={dead || !sessionId} error={navError} onGo={(address) => void nav({ op: "goto", address })} onOp={(op) => void nav({ op })} />
      )}

      <div className="relative aspect-[16/10] w-full bg-black">
        {showFrame && <iframe key={attempt} ref={frame} src={src} title="Live browser" allow="autoplay; clipboard-read; clipboard-write" className={`size-full ${pip.expanded ? "" : "pointer-events-none"}`} data-testid="live-view" />}
        {!playing && (
          <div className={`absolute inset-0 grid place-items-center px-5 text-center ${view.kind === "connecting" ? "pointer-events-none bg-black/70" : "bg-surface"}`} data-testid="view-note" aria-live="polite">
            <div className="max-w-[28ch] space-y-1.5">
              <p className="text-[12.5px] text-fg-muted">{note.title}</p>
              {note.detail && pip.expanded && <p className="text-[11.5px] leading-snug text-fg-dim">{note.detail}</p>}
              {note.action === "reconnect" && <button type="button" onClick={() => { dispatch({ t: "retry" }); setAttempt((a) => a + 1); }} className="press mt-1 h-7 rounded-full border border-line px-3 text-[12px] text-fg-muted hover:border-dock-line hover:text-fg">Try again</button>}
              {note.action === "open" && <button type="button" onClick={() => void openNew()} disabled={opening || !sessionId} className="press mt-1 h-7 rounded-full bg-fg px-3 text-[12px] font-medium text-canvas hover:bg-white disabled:opacity-50">{opening ? "Starting…" : "Open a new browser"}</button>}
            </div>
          </div>
        )}
        {!pip.expanded && !dead && <button type="button" onClick={() => setPip({ expanded: true })} aria-label="Expand the browser" className="absolute inset-0 cursor-zoom-in" />}
      </div>

      <ul className="space-y-0.5 px-3 py-2" data-testid="pip-actions" aria-live="polite">
        {actions.length === 0 && <li className="text-[12px] text-fg-dim">{busy ? "Watching the page…" : dead ? "Nothing is running." : "No browser actions yet"}</li>}
        {actions.map((a) => (
          <li key={a.id} className="rise flex items-center gap-2 text-[12px] text-fg-muted" title={a.detail ? `${a.label} — ${a.detail}` : a.label}>
            <span className={`size-1.5 shrink-0 rounded-full ${DOT[a.state]}`} />
            <span className="truncate">{a.label}</span>
          </li>
        ))}
      </ul>

      {pip.expanded && (
        <>
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim" data-testid="control-hint">{control ? "You are in control. The agent sees what you do." : "Watching. Take over to click and type yourself."}</span>
            <button type="button" onClick={toggleControl} disabled={!playing} aria-pressed={control} className="press h-7 shrink-0 rounded-full border border-line bg-surface px-3 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">{control ? "Give back control" : "Take over"}</button>
          </div>
          <AgentBox busy={busy} disabled={dead || !sessionId} onSend={(task) => void send(task, { browse: true })} onStop={stop} />
        </>
      )}
    </div>
  );
}
