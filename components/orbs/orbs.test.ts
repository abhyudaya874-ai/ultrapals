import { describe, expect, it } from "vitest";
import { createBudget } from "./budget";
import { REST, blinkAmount, eyeLayout, lookAt } from "./gaze";
import { eyeOn, gradientFor, hash, hsl, lookFor, roleOf, tierOf, WORKER_COLOR } from "./palette";

describe("palette", () => {
  it.each([["main", "ultra"], ["research", "worker"], ["browser", "worker"], ["terminal", "worker"], ["sandbox", "worker"], ["superpal", "pal"], ["rival", "pal"], ["situation", "pal"], ["promise", "pal"], ["battle", "battle"], ["whatever", "worker"]])("%s is %s", (role, tier) => expect(tierOf(role)).toBe(tier));
  it.each([["main", "main"], ["research-3", "research"], ["superpal-stripe", "superpal"], ["terminal-1", "terminal"], ["situation-2", "situation"]])("roleOf(%s) = %s", (id, role) => expect(roleOf(id)).toBe(role));
  it("workers are one plain colour each, all different", () => {
    const looks = ["research", "browser", "terminal", "sandbox"].map((r) => lookFor(`${r}-1`));
    expect(looks.every((l) => l.kind === "plain")).toBe(true);
    expect(new Set(looks.map((l) => (l.kind === "plain" ? l.color : ""))).size).toBe(4);
    expect(lookFor("research-1")).toMatchObject({ color: WORKER_COLOR.research });
  });
  it("Pals and SuperPals are gradients, and each SuperPal has its own", () => {
    expect(lookFor("rival-1").kind).toBe("gradient");
    const a = lookFor("superpal-stripe");
    const b = lookFor("superpal-square");
    expect(a.kind).toBe("gradient");
    expect(a).not.toEqual(b);
    expect(lookFor("superpal-stripe")).toEqual(a);
  });
  it("an unknown role still gets a colour", () => expect(lookFor("mystery-1")).toMatchObject({ kind: "plain" }));
  it("hash is stable and spreads", () => {
    expect(hash("a")).toBe(hash("a"));
    expect(new Set(["a", "b", "c", "d", "e"].map(hash)).size).toBe(5);
  });
  it.each([[0, 100, 50, "#ff0000"], [120, 100, 50, "#00ff00"], [240, 100, 50, "#0000ff"], [0, 0, 100, "#ffffff"], [0, 0, 0, "#000000"]])("hsl(%i,%i,%i) = %s", (h, s, l, hex) => expect(hsl(h, s, l)).toBe(hex));
  it("gradients are three valid hex colours", () => {
    for (const id of ["x", "superpal-wise", "c1-skeptic"]) expect(gradientFor(id)).toHaveLength(3);
    for (const c of gradientFor("anything")) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it.each([["#ffffff", "#09090B"], ["#F4F4F5", "#09090B"], ["#18181B", "#F4F4F5"], ["#000", "#F4F4F5"], ["#c9a14a", "#09090B"], ["nope", "#09090B"]])("eyes on %s are %s", (bg, eye) => expect(eyeOn(bg)).toBe(eye));
});

describe("gaze", () => {
  const box = { left: 100, top: 100, width: 40, height: 40 };
  it("looks toward the pointer, y up, and clamps", () => {
    expect(lookAt({ x: 120, y: 120 }, box)).toEqual({ x: 0, y: 0 });
    expect(lookAt({ x: 1000, y: -1000 }, box)).toEqual({ x: 1, y: 1 });
    expect(lookAt({ x: -1000, y: 1000 }, box)).toEqual({ x: -1, y: -1 });
    expect(lookAt({ x: 130, y: 120 }, box).x).toBeCloseTo(0.5);
  });
  it("an orb with no size looks straight ahead", () => expect(lookAt({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual(REST));
  it("two symmetric eyes when looking straight ahead", () => {
    const [l, r] = eyeLayout({ x: 0, y: 0 }, 100);
    expect(l.cx + r.cx).toBeCloseTo(100);
    expect(l.cy).toBeCloseTo(r.cy);
    expect(l.h).toBeGreaterThan(l.w);
    expect(l.o).toBe(1);
  });
  it("both eyes move toward where it looks", () => {
    const ahead = eyeLayout({ x: 0, y: 0 }, 100);
    const right = eyeLayout({ x: 0.8, y: 0 }, 100);
    expect(right[0].cx).toBeGreaterThan(ahead[0].cx);
    expect(right[1].cx).toBeGreaterThan(ahead[1].cx);
    const up = eyeLayout({ x: 0, y: 0.8 }, 100);
    expect(up[0].cy).toBeLessThan(ahead[0].cy);
  });
  it("looking right, the right eye nears the edge and is narrower than the left; and opacity always stays within 0..1", () => {
    const [l, r] = eyeLayout({ x: 1, y: 0 }, 100);
    expect(r.w).toBeLessThan(l.w);
    for (const look of [{ x: 1, y: 1 }, { x: -1, y: -1 }, { x: 0, y: 0 }, { x: 1, y: -1 }]) {
      for (const e of eyeLayout(look, 100)) { expect(e.o).toBeGreaterThanOrEqual(0); expect(e.o).toBeLessThanOrEqual(1); expect(e.w).toBeGreaterThan(0); }
    }
  });
  it("a blink flattens the eyes", () => {
    const open = eyeLayout({ x: 0, y: 0 }, 100, 0)[0];
    const shut = eyeLayout({ x: 0, y: 0 }, 100, 1)[0];
    expect(shut.h).toBeLessThan(open.h / 2);
  });
  it("scales with the box", () => expect(eyeLayout({ x: 0, y: 0 }, 200)[0].h).toBeCloseTo(eyeLayout({ x: 0, y: 0 }, 100)[0].h * 2));
  it.each([[-1, 0], [0, 0], [0.03, 0.03 / 0.055], [0.055, 1], [0.08, 1], [0.14, 0.5], [0.18, 0], [1, 0]])("blink at %fs = %f", (t, v) => expect(blinkAmount(t)).toBeCloseTo(v));
});

describe("GPU budget", () => {
  it("hands out only as many slots as allowed and takes them back", () => {
    const b = createBudget(2);
    expect([b.acquire(), b.acquire(), b.acquire()]).toEqual([true, true, false]);
    b.release();
    expect(b.acquire()).toBe(true);
    expect(b.used).toBe(2);
  });
  it("releasing more than was taken never goes negative", () => {
    const b = createBudget(1);
    b.release();
    b.release();
    expect(b.used).toBe(0);
    expect(b.acquire()).toBe(true);
  });
});

import { glanceEvery, moodLook, moodOf, squint, thinkingState, ultraState } from "./mood";
import { applyCEvent, newRun } from "@/lib/computer/run";
import type { CEvent } from "@/lib/computer/events";

describe("mood", () => {
  it("a thinking orb looks up, a busy one looks down, an unhappy one down and to the left", () => {
    for (const [a, b] of [[0, 0], [0.5, 0.5], [1, 1]]) {
      expect(moodLook("thinking", a, b).y).toBeGreaterThan(0.2);
      expect(moodLook("busy", a, b).y).toBeLessThan(-0.1);
      expect(moodLook("error", a, b)).toMatchObject({ x: expect.any(Number) });
      expect(moodLook("error", a, b).x).toBeLessThan(0);
      expect(Math.abs(moodLook("idle", a, b).x)).toBeLessThanOrEqual(0.8);
    }
  });
  it("squints more when busy or worried, never when idle", () => {
    expect(squint("idle")).toBe(0);
    expect(squint("done")).toBe(0);
    expect(squint("busy")).toBeGreaterThan(squint("thinking"));
    expect(squint("error")).toBeGreaterThan(squint("busy"));
  });
  it("a thinking orb glances more often than an idle one", () => expect(glanceEvery("thinking")[1]).toBeLessThan(glanceEvery("idle")[0] + 2000));
});

describe("ultraState", () => {
  const run = (...e: CEvent[]) => e.reduce(applyCEvent, newRun("r", "p"));
  const agent = (id: string, role: "research" | "browser" | "terminal", state: "running" | "ok"): CEvent => ({ kind: "agent", id, role, title: id, state });
  it("idle with no run, or when nothing is running", () => {
    expect(ultraState(undefined, false)).toBe("idle");
    expect(ultraState(run({ kind: "done", used: [], model: "m", ms: 1 }), false)).toBe("idle");
  });
  it("thinking while it plans, working while subagents run, talking once the answer streams", () => {
    expect(ultraState(run(), true)).toBe("thinking");
    expect(ultraState(run(agent("research-1", "research", "running"), agent("browser-1", "browser", "ok")), true)).toBe("working");
    expect(ultraState(run(agent("terminal-1", "terminal", "running"), { kind: "answer", delta: "Hi" }), true)).toBe("talking");
  });
  it("shows an error after a run that failed", () => expect(ultraState(run({ kind: "error", message: "x" }), false)).toBe("error"));
});

describe("thinkingState: which dot animation shows what a contender is doing", () => {
  it.each([
    [{ state: "pending", tool: "research" }, "waiting"],
    [{ state: "running", tool: "research" }, "searching"],
    [{ state: "running", tool: "browser" }, "using"],
    [{ state: "running", tool: "terminal" }, "working"],
    [{ state: "ok", tool: "terminal" }, "idle"],
    [{ state: "error", tool: "browser" }, "retrying"],
    [{ state: "running", tool: "browser", judging: true }, "compacting"],
    [{ state: "ok", tool: "research", judging: true }, "compacting"],
  ] as const)("%j -> %s", (o, want) => expect(thinkingState(o)).toBe(want));
  it.each([["error", "error"], ["running", "busy"], ["pending", "thinking"], ["ok", "done"]] as const)("mood of %s is %s", (s, m) => expect(moodOf(s)).toBe(m));
});
