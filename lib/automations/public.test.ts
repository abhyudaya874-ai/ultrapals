import { describe, expect, it } from "vitest";
import { newAutomation, Spec } from "./core";
import { toPublic } from "./public";
import { same } from "./token";

const a = () => ({ ...newAutomation(Spec.parse({ name: "n", prompt: "do the thing", schedule: { kind: "every", minutes: 360 } }), "id1", 0), runLog: [1, 2], runs: [{ id: "r", atMs: 5, ms: 1, status: "ok" as const, answer: "ok", agents: [], files: [{ path: "/workspace/a.csv", content: "x,y\n1,2\n" }], sources: [] }] });

describe("toPublic", () => {
  it("the list view reports file sizes, never contents", () => {
    const p = toPublic(a(), 1000, false);
    expect(p.runs[0].files).toEqual([{ path: "/workspace/a.csv", bytes: 8 }]);
    expect(p).toMatchObject({ scheduleText: "Every 6 hours", running: false, runsToday: 2, dailyCap: 12, lastRunMs: null });
  });
  it("the detail view includes the contents", () => expect(toPublic(a(), 1000, true).runs[0].files[0].content).toBe("x,y\n1,2\n"));
  it("says running while a claim is held", () => expect(toPublic({ ...a(), runningSince: 5 }, 10, false).running).toBe(true));
});

describe("same", () => {
  it.each([["abc", "abc", true], ["abc", "abd", false], ["abc", "ab", false], ["", "", true], ["", "x", false]])("%j vs %j", (x, y, want) => expect(same(x, y)).toBe(want));
});
