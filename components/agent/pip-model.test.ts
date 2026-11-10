import { describe, expect, it } from "vitest";
import type { CEvent } from "@/lib/computer/events";
import { applyCEvent, newRun } from "@/lib/computer/run";
import { clampOffset, recentBrowserActions } from "./pip-model";

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
