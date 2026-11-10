import type { RunState } from "@/lib/computer/events";
import type { Run } from "@/lib/computer/run";

export interface PipAction {
  id: string;
  label: string;
  state: RunState;
  detail?: string;
}

/**
 * Pure. The latest things the live browser did, for the corner player's ticker: every step of a BrowserPal, plus the "Opening <site> in the
 * browser" steps readers take. Newest last. Taken from the most recent run that used the browser, so an old run does not linger.
 */
export function recentBrowserActions(runs: readonly Run[], n: number): PipAction[] {
  for (let i = runs.length - 1; i >= 0; i--) {
    const acts = runs[i].agents.flatMap((a) => a.steps.filter((s) => a.role === "browser" || s.id.endsWith("-browser")).map((s): PipAction => ({ id: `${a.id}:${s.id}`, label: s.label, state: s.state, detail: s.detail })));
    if (acts.length) return acts.slice(-n);
  }
  return [];
}

/** Pure. Clamps a dragged offset so the player always stays fully inside the window (with `margin` px to spare). */
export function clampOffset(o: { x: number; y: number }, box: { w: number; h: number }, view: { w: number; h: number }, margin = 8): { x: number; y: number } {
  // the player rests at the bottom right: offsets are relative to that spot, so they can only move it left and up
  const minX = -(view.w - box.w - margin * 2);
  const minY = -(view.h - box.h - margin * 2);
  return { x: Math.min(0, Math.max(Math.min(0, minX), o.x)), y: Math.min(0, Math.max(Math.min(0, minY), o.y)) };
}

/* ───────────────────────── the live view's connection ───────────────────────── */

/**
 * Where the live view is in connecting. Kernel's viewer posts KERNEL_PLAYING once frames arrive, KERNEL_CONNECTION_FAILED / _TIMEOUT when it gives up,
 * and says nothing at all when the browser has been deleted (its page just reads "Session not found"). So "no message yet" must never be shown as
 * "Connecting…" for ever: a watchdog turns it into a failure, and the server's answer to "is the browser still there?" turns it into `closed`.
 */
export type ViewState =
  | { kind: "connecting"; tries: number }
  | { kind: "playing" }
  | { kind: "failed"; reason: string; tries: number }
  | { kind: "closed" };
export type ViewEvent =
  | { t: "message"; type: string; reason?: string }
  | { t: "watchdog" }
  | { t: "server"; alive: boolean }
  | { t: "retry" }
  | { t: "reset" };

/** The viewer's own connect bounds add up to 48 s; the watchdog must outlast them (Kernel's guidance: 60 s). */
export const WATCHDOG_MS = 60_000;
/** Automatic reconnects before the person is asked. A transport or network failure deserves one more try; more is a loop. */
export const AUTO_RETRIES = 1;
export const START: ViewState = { kind: "connecting", tries: 0 };

const tries = (s: ViewState): number => (s.kind === "connecting" || s.kind === "failed" ? s.tries : 0);

export function nextView(s: ViewState, e: ViewEvent): ViewState {
  switch (e.t) {
    case "reset": return START;
    case "retry": return s.kind === "closed" ? s : { kind: "connecting", tries: tries(s) + 1 };
    case "server": return e.alive ? s : { kind: "closed" };
    case "watchdog": return s.kind === "connecting" ? { kind: "failed", reason: "no-video", tries: s.tries } : s;
    case "message":
      if (s.kind === "closed") return s;
      if (e.type === "KERNEL_PLAYING") return { kind: "playing" };
      if (e.type === "KERNEL_PAUSED") return s.kind === "playing" ? { kind: "connecting", tries: 0 } : s;
      if (e.type === "KERNEL_CONNECTION_FAILED" || e.type === "KERNEL_CONNECTION_TIMEOUT") return { kind: "failed", reason: e.reason ?? "connect", tries: tries(s) };
      return s;
  }
}

/** Pure. Whether a failed view should reconnect by itself: once, and not when retrying cannot help (this browser has no video support, or the offer was refused). */
export const shouldAutoRetry = (s: ViewState): boolean => s.kind === "failed" && s.tries < AUTO_RETRIES && s.reason !== "unsupported" && s.reason !== "peer";

/** Pure. What to tell the person over a view that is not playing. */
export function viewNote(s: ViewState): { title: string; detail?: string; action?: "reconnect" | "open" } {
  switch (s.kind) {
    case "connecting": return { title: s.tries > 0 ? "Reconnecting…" : "Connecting…" };
    case "playing": return { title: "" };
    case "closed": return { title: "This browser has closed", detail: "A browser closes after a few minutes without use. Open a new one to carry on.", action: "open" };
    case "failed":
      return s.reason === "unsupported"
        ? { title: "This browser cannot show the live view", detail: "It needs WebRTC video support." }
        : s.reason === "media" || s.reason === "no-video"
          ? { title: "The live view did not start", detail: "The video connection may be blocked by a firewall or VPN.", action: "reconnect" }
          : { title: "Could not reach the live view", detail: "Check your connection, then try again.", action: "reconnect" };
  }
}
