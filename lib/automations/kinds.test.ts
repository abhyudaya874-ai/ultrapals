import { describe, expect, it } from "vitest";
import { Spec } from "./core";
import { DEFAULT_KIND, IDEAS, KINDS, KIND_INFO, MAX_HEAVY_ON, TEAM_OF, countFor, dailyCapFor, isKind, kindOf, staleFor, timeoutFor } from "./kinds";
import { PRESETS, buildSchedule, presetsFor } from "./presets";

describe("every kind is fully described", () => {
  it.each(KINDS)("%s", (k) => {
    const i = KIND_INFO[k];
    expect(i.label.length).toBeGreaterThan(2);
    expect(i.blurb.endsWith(".")).toBe(true);
    expect(i.placeholder.length).toBeGreaterThan(10);
    expect(i.minMinutes).toBeGreaterThanOrEqual(30);
    expect(i.dailyCap).toBeGreaterThan(0);
    expect(i.timeoutMs).toBeGreaterThanOrEqual(8 * 60_000);
    // a delegate a kind goes first with can never be one it also forbids
    if (i.first) expect(i.deny).not.toContain(i.first);
    // the delegates no automation may use are fixed in run.ts; a kind never needs to repeat them
    expect(i.deny).not.toContain("promise");
  });
  it("only Battles and Loops are heavy, and they are the only ones that count teams or rounds", () => {
    expect(KINDS.filter((k) => KIND_INFO[k].heavy)).toEqual(["battle", "loop"]);
    expect(KINDS.filter((k) => KIND_INFO[k].count)).toEqual(["battle", "loop"]);
  });
  it("a heavy kind repeats rarely and runs seldom: it opens a cloud computer for every team", () => {
    for (const k of ["battle", "loop"] as const) {
      expect(KIND_INFO[k].minMinutes).toBeGreaterThanOrEqual(360);
      expect(KIND_INFO[k].dailyCap).toBeLessThanOrEqual(3);
      expect(timeoutFor(k)).toBeGreaterThan(timeoutFor("task"));
    }
    expect(MAX_HEAVY_ON).toBe(2);
  });
  it("a stale claim is later than the run's own time limit", () => {
    for (const k of KINDS) expect(staleFor(k)).toBeGreaterThan(timeoutFor(k));
  });
});

describe("reading a kind from data nobody can trust", () => {
  it.each([[undefined], [null], [""], ["nonsense"], [3]])("%j is a Team task", (v) => expect(kindOf(v)).toBe(DEFAULT_KIND));
  it("keeps a real kind", () => {
    for (const k of KINDS) expect(kindOf(k)).toBe(k);
    expect(isKind("watch")).toBe(true);
    expect(isKind("Watch")).toBe(false);
  });
});

describe("countFor", () => {
  it("clamps into the kind's range and defaults when absent; other kinds have none", () => {
    expect(countFor("battle", undefined)).toBe(3);
    expect(countFor("battle", 9)).toBe(4);
    expect(countFor("loop", 1)).toBe(2);
    expect(countFor("task", 3)).toBeUndefined();
  });
});

describe("the ideas offered for each kind", () => {
  it.each(KINDS)("%s has at least three, and each one creates a valid automation of that kind", (k) => {
    expect(IDEAS[k].length).toBeGreaterThanOrEqual(3);
    for (const idea of IDEAS[k]) {
      expect(presetsFor(k).some((p) => p.id === idea.preset)).toBe(true);
      const made = Spec.safeParse({ name: idea.title, prompt: idea.prompt, schedule: buildSchedule(idea.preset, "09:00"), kind: k, ...(idea.count !== undefined ? { count: idea.count } : {}) });
      expect(made.success, `${k}: ${idea.title}`).toBe(true);
    }
  });
  it("titles are unique within a kind, and prompts name their subject (an address for pages, a question for contests)", () => {
    for (const k of KINDS) expect(new Set(IDEAS[k].map((i) => i.title)).size).toBe(IDEAS[k].length);
    for (const k of ["browser", "watch"] as const) for (const i of IDEAS[k]) expect(i.prompt).toMatch(/https:\/\//);
    for (const k of ["battle", "loop"] as const) for (const i of IDEAS[k]) expect(i.count).toBeGreaterThanOrEqual(2);
  });
  it("a Battle idea is a question where methods can disagree, not a task", () => {
    for (const i of IDEAS.battle) expect(i.prompt).toMatch(/\?|Give a prediction/);
  });
});

describe("presets by kind", () => {
  it("a Battle or a Loop cannot repeat more often than every six hours", () => {
    expect(presetsFor("battle").map((p) => p.id)).toEqual(["6h", "12h", "daily", "weekdays", "weekends", "weekly"]);
    expect(presetsFor("loop")).toEqual(presetsFor("battle"));
  });
  it("a page watch may repeat every half hour", () => expect(presetsFor("watch").map((p) => p.id)).toEqual(PRESETS.map((p) => p.id)));
  it("a rail check or a deal exam: no more than hourly", () => {
    expect(presetsFor("rails").map((p) => p.id)).not.toContain("30m");
    expect(presetsFor("exam").map((p) => p.id)).toContain("1h");
  });
});

describe("dailyCapFor", () => {
  it("is the kind's own", () => {
    expect(dailyCapFor("task")).toBe(12);
    expect(dailyCapFor("battle")).toBe(3);
  });
});

describe("who works on each kind", () => {
  it.each(KINDS)("%s names its team, with no one twice", (k) => {
    expect(TEAM_OF[k].length).toBeGreaterThanOrEqual(2);
    expect(new Set(TEAM_OF[k]).size).toBe(TEAM_OF[k].length);
  });
  it("the agent that goes first on a kind is the one at the front of its team", () => {
    for (const k of KINDS) if (KIND_INFO[k].first) expect(TEAM_OF[k][0], k).toBe(KIND_INFO[k].first);
  });
  it("UltraPal is on every team, in front for the whole-team and contest kinds and behind the specialist otherwise", () => {
    for (const k of KINDS) expect(TEAM_OF[k]).toContain("main");
    for (const k of ["task", "battle", "loop"] as const) expect(TEAM_OF[k][0]).toBe("main");
    for (const k of ["research", "browser", "watch", "rails", "exam"] as const) expect(TEAM_OF[k][0]).not.toBe("main");
  });
  it("a kind with an agent forbidden to it never lists that agent", () => {
    for (const k of KINDS) for (const denied of KIND_INFO[k].deny) expect(TEAM_OF[k], `${k} lists ${denied}`).not.toContain(denied);
  });
  it("a Battle shows teams and a Loop rounds, as many as it is allowed", () => {
    expect(TEAM_OF.battle.filter((x) => /^c\d-/.test(x)).length).toBeLessThanOrEqual(KIND_INFO.battle.count!.max);
    expect(TEAM_OF.loop.filter((x) => /^r\d-/.test(x)).length).toBeLessThanOrEqual(KIND_INFO.loop.count!.max);
  });
});
