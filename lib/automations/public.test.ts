import { describe, expect, it } from "vitest";
import { newAutomation, Spec } from "./core";
import { toBrief, toPublic } from "./public";
import { same } from "./token";

const a = () => ({ ...newAutomation(Spec.parse({ name: "n", prompt: "do the thing", schedule: { kind: "every", minutes: 360 } }), "id1", 0), runLog: [1, 2], runs: [{ id: "r", atMs: 5, ms: 1, status: "ok" as const, answer: "ok", agents: [], files: [{ path: "/workspace/a.csv", content: "x,y\n1,2\n" }], sources: [] }] });

describe("toPublic", () => {
  it("the list view reports file sizes, never contents", () => {
    const p = toPublic(a(), 1000, false);
    expect(p.runs[0].files).toEqual([{ path: "/workspace/a.csv", bytes: 8 }]);
    expect(p).toMatchObject({ scheduleText: "Every 6 hours", running: false, runsToday: 2, dailyCap: 12, lastRunMs: null });
  });
  it("says what kind it is, its count and its own daily cap", () => {
    const b = { ...newAutomation(Spec.parse({ name: "n", prompt: "which is cheaper?", schedule: { kind: "every", minutes: 360 }, kind: "battle", count: 3 }), "id2", 0) };
    expect(toPublic(b, 1000, false)).toMatchObject({ kind: "battle", count: 3, dailyCap: 3 });
    expect(toPublic(a(), 1000, false)).toMatchObject({ kind: "task", count: null, dailyCap: 12 });
  });
  it("the detail view includes the contents", () => expect(toPublic(a(), 1000, true).runs[0].files[0].content).toBe("x,y\n1,2\n"));
  it("says running while a claim is held", () => expect(toPublic({ ...a(), runningSince: 5 }, 10, false).running).toBe(true));
});

describe("same", () => {
  it.each([["abc", "abc", true], ["abc", "abd", false], ["abc", "ab", false], ["", "", true], ["", "x", false]])("%j vs %j", (x, y, want) => expect(same(x, y)).toBe(want));
});

describe("toBrief (the sidebar's light listing)", () => {
  it("has no prompt and no run output, only what the row shows", () => {
    const b = toBrief(a());
    expect(b).toEqual({ id: "id1", name: "n", kind: "task", count: null, enabled: true, running: false, scheduleText: "Every 6 hours", createdAtMs: 0, lastRunMs: null, last: "ok", blocked: false });
    expect(JSON.stringify(b)).not.toContain("do the thing");
  });
  it("shows the latest run's outcome, a wall it met, and whether it is running now", () => {
    const x = a();
    const latest = { ...x.runs[0], status: "error" as const, blocked: "Blocked: a CAPTCHA" };
    expect(toBrief({ ...x, runs: [latest, ...x.runs], runningSince: 5 })).toMatchObject({ last: "error", blocked: true, running: true });
    expect(toBrief({ ...x, runs: [] }).last).toBeNull();
  });
});
