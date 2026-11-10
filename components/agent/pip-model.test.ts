import { describe, expect, it } from "vitest";
import type { CEvent } from "@/lib/computer/events";
import { applyCEvent, newRun } from "@/lib/computer/run";
import { AUTO_RETRIES, START, clampOffset, nextView, recentBrowserActions, shouldAutoRetry, viewNote, type ViewEvent, type ViewState } from "./pip-model";

const run = (...e: CEvent[]) => e.reduce(applyCEvent, newRun("r", "p"));
const step = (agent: string, id: string, label: string, state: "running" | "ok" | "error" = "ok"): CEvent => ({ kind: "step", agent, id, label, state });

describe("recentBrowserActions", () => {
  it("lists a BrowserPal's steps and the reader's browser steps, newest last, capped", () => {
    const r = run(
      { kind: "agent", id: "browser-1", role: "browser", title: "BrowserPal", state: "running" },
      step("browser-1", "s1", "Go to checkout"), step("browser-1", "s2", "Click Pay"), step("browser-1", "s3", "Type email"), step("browser-1", "s4", "Click Next"),
      step("superpal-stripe", "read-x-browser", "Opened stripe.com in the browser"),
      step("terminal-1", "s1", "ls"),
    );
    expect(recentBrowserActions([r], 3).map((a) => a.label)).toEqual(["Type email", "Click Next", "Opened stripe.com in the browser"]);
  });
  it("uses the newest run that used the browser, and nothing when none did", () => {
    const old = run({ kind: "agent", id: "browser-1", role: "browser", title: "B", state: "ok" }, step("browser-1", "s1", "Old click"));
    const newer = run({ kind: "agent", id: "research-1", role: "research", title: "R", state: "ok" }, step("research-1", "s1", "Search"));
    expect(recentBrowserActions([old, newer], 4).map((a) => a.label)).toEqual(["Old click"]);
    expect(recentBrowserActions([newer], 4)).toEqual([]);
    expect(recentBrowserActions([], 4)).toEqual([]);
  });
});

describe("clampOffset", () => {
  const box = { w: 232, h: 300 };
  const view = { w: 1000, h: 800 };
  it("cannot move right or down of its resting spot", () => expect(clampOffset({ x: 50, y: 40 }, box, view)).toEqual({ x: 0, y: 0 }));
  it("cannot leave the window to the left or the top", () => expect(clampOffset({ x: -5000, y: -5000 }, box, view)).toEqual({ x: -(1000 - 232 - 16), y: -(800 - 300 - 16) }));
  it("a position inside is kept", () => expect(clampOffset({ x: -100, y: -50 }, box, view)).toEqual({ x: -100, y: -50 }));
  it("a window smaller than the player does not produce a positive offset", () => expect(clampOffset({ x: -10, y: -10 }, { w: 500, h: 500 }, { w: 300, h: 300 })).toEqual({ x: 0, y: 0 }));
});


const view = (events: ViewEvent[], from: ViewState = START): ViewState => events.reduce(nextView, from);
const msg = (type: string, reason?: string): ViewEvent => ({ t: "message", type, reason });

describe("the live view's connection", () => {
  it("starts connecting and plays when frames arrive", () => {
    expect(START).toEqual({ kind: "connecting", tries: 0 });
    expect(view([msg("KERNEL_CONNECTED"), msg("KERNEL_PLAYING")])).toEqual({ kind: "playing" });
  });
  it("connected is not playing: it keeps waiting for frames", () => expect(view([msg("KERNEL_CONNECTED")])).toEqual(START));
  it("a viewer that gives up is a failure with the reason it gave", () => {
    expect(view([msg("KERNEL_CONNECTION_FAILED", "transport")])).toEqual({ kind: "failed", reason: "transport", tries: 0 });
    expect(view([msg("KERNEL_CONNECTION_TIMEOUT", "media")])).toEqual({ kind: "failed", reason: "media", tries: 0 });
    expect(view([msg("KERNEL_CONNECTION_FAILED")])).toMatchObject({ reason: "connect" });
  });
  it("silence is a failure too: the watchdog turns an endless 'Connecting…' into something the person can act on", () => {
    expect(view([{ t: "watchdog" }])).toEqual({ kind: "failed", reason: "no-video", tries: 0 });
  });
  it("the watchdog does nothing once the video plays", () => expect(view([msg("KERNEL_PLAYING"), { t: "watchdog" }])).toEqual({ kind: "playing" }));
  it("paused video goes back to waiting; a pause before it ever played is ignored", () => {
    expect(view([msg("KERNEL_PLAYING"), msg("KERNEL_PAUSED")])).toEqual({ kind: "connecting", tries: 0 });
    expect(view([msg("KERNEL_PAUSED")])).toEqual(START);
  });
  it("the server saying the browser is gone is final, whatever the viewer says afterwards", () => {
    expect(view([msg("KERNEL_PLAYING"), { t: "server", alive: false }])).toEqual({ kind: "closed" });
    expect(view([{ t: "server", alive: false }, msg("KERNEL_PLAYING"), { t: "retry" }, { t: "watchdog" }])).toEqual({ kind: "closed" });
  });
  it("the server saying it is alive changes nothing", () => expect(view([msg("KERNEL_PLAYING"), { t: "server", alive: true }])).toEqual({ kind: "playing" }));
  it("retrying counts the attempts; a new address starts over", () => {
    expect(view([{ t: "watchdog" }, { t: "retry" }])).toEqual({ kind: "connecting", tries: 1 });
    expect(view([{ t: "watchdog" }, { t: "retry" }, { t: "watchdog" }])).toEqual({ kind: "failed", reason: "no-video", tries: 1 });
    expect(view([{ t: "watchdog" }, { t: "retry" }, { t: "reset" }])).toEqual(START);
    expect(view([{ t: "reset" }], { kind: "closed" })).toEqual(START);
  });
  it("ignores messages it does not know", () => expect(view([msg("SOMETHING_ELSE")])).toEqual(START));
});

describe("shouldAutoRetry", () => {
  it("reconnects once on a network-looking failure, then leaves it to the person", () => {
    expect(AUTO_RETRIES).toBe(1);
    expect(shouldAutoRetry({ kind: "failed", reason: "transport", tries: 0 })).toBe(true);
    expect(shouldAutoRetry({ kind: "failed", reason: "no-video", tries: 0 })).toBe(true);
    expect(shouldAutoRetry({ kind: "failed", reason: "transport", tries: 1 })).toBe(false);
  });
  it("does not retry what a retry cannot fix, or states that are not failures", () => {
    expect(shouldAutoRetry({ kind: "failed", reason: "unsupported", tries: 0 })).toBe(false);
    expect(shouldAutoRetry({ kind: "failed", reason: "peer", tries: 0 })).toBe(false);
    expect(shouldAutoRetry({ kind: "closed" })).toBe(false);
    expect(shouldAutoRetry(START)).toBe(false);
  });
});

describe("viewNote", () => {
  it("says what happened and what can be done about it", () => {
    expect(viewNote(START).title).toBe("Connecting…");
    expect(viewNote({ kind: "connecting", tries: 1 }).title).toBe("Reconnecting…");
    expect(viewNote({ kind: "closed" })).toMatchObject({ title: "This browser has closed", action: "open" });
    expect(viewNote({ kind: "failed", reason: "media", tries: 0 })).toMatchObject({ action: "reconnect", detail: expect.stringMatching(/firewall or VPN/) });
    expect(viewNote({ kind: "failed", reason: "transport", tries: 0 }).action).toBe("reconnect");
    expect(viewNote({ kind: "failed", reason: "unsupported", tries: 0 }).action).toBeUndefined();
  });
  it("has nothing to say over a playing video", () => expect(viewNote({ kind: "playing" }).title).toBe(""));
});
