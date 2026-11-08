import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/agent/types";
import type { Verdict } from "@/lib/verdict";
import { formatDuration } from "./format";
import { durationFromLog, groupTrace, isDegraded, processCounts, stepSummary, toolVerb } from "./group-trace";

const DURATIONS: [string, number, string][] = [
  ["sub-second", 412, "412ms"],
  ["one second exactly", 1000, "1.0s"],
  ["tenths, truncated", 1299, "1.2s"],
  ["just under a minute", 59_999, "59.9s"],
  ["minutes + seconds", 21 * 60_000 + 40_000, "21m 40s"],
  ["hours + minutes", 3_780_000, "1h 3m"],
  ["negative is clamped", -5, "0ms"],
  ["NaN is clamped", Number.NaN, "0ms"],
];
describe("formatDuration", () => {
  it.each(DURATIONS)("%s", (_n, ms, want) => expect(formatDuration(ms)).toBe(want));
});

// What the panel really holds after upsertEvent: subagent rows keep their FIRST position.
const VERDICT: Verdict = {
  kind: "indeterminate",
  reason: "FACT_MISSING",
  consequence: "WAIT",
  diag: { committedMinor: 1000, observedMinor: null, conditionKind: "price_at_most", windowEndsAtMs: 2, nowMs: 1, windowClosed: false },
};
const LIVE: TraceEvent[] = [
  { kind: "subagent", id: "guard-1", agent: "guard", title: "Capture guard", state: "ok", ms: 12 },
  { kind: "subagent", id: "observer-2", agent: "observer", title: "Condition observer", state: "ok", ms: 310 },
  { kind: "tool", id: "tool-3", name: "paypal.getOrder", args: { orderId: "O-1" }, state: "ok", ms: 290 },
  { kind: "subagent", id: "resolver-4", agent: "resolver", title: "Condition resolver", state: "ok", ms: 900 },
  { kind: "tool", id: "tool-5", name: "channel3.search", args: { query: "shoes" }, state: "error", ms: 800, error: "channel3 off" },
  { kind: "thought", id: "note-6", text: "Degraded: channel3.search: channel3 off" },
  { kind: "diff", id: "diff-7", path: "lib/verdict.ts", hunks: ["function decide() {", "}"], state: "settled", adds: 2, removes: 0 },
  { kind: "verdict", id: "verdict-8", verdict: VERDICT },
  { kind: "thought", id: "explain-9", text: "The evidence could not be read, so nothing is decided or captured yet." },
  { kind: "done", id: "done-10", state: "open", deduped: false },
];

describe("groupTrace", () => {
  const v = groupTrace(LIVE);
  it("a subagent row opens a group and owns the rows after it", () => {
    expect(v.groups.map((g) => g.agent)).toEqual(["guard", "observer", "resolver"]);
    expect(v.groups[1].items.map((i) => i.id)).toEqual(["tool-3"]);
    expect(v.groups[2].items.map((i) => i.id)).toEqual(["tool-5", "note-6", "diff-7"]);
  });
  it("verdict, done, explanation and diff are lifted out", () => {
    expect(v.verdict?.id).toBe("verdict-8");
    expect(v.done?.state).toBe("open");
    expect(v.explanation).toMatch(/could not be read/);
    expect(v.diff?.path).toBe("lib/verdict.ts");
  });
  it("events before any subagent row land in a synthetic 'run' group, never get dropped", () => {
    const early = groupTrace([{ kind: "tool", id: "t1", name: "x.y", args: {}, state: "running" }]);
    expect(early.groups).toHaveLength(1);
    expect(early.groups[0].id).toBe("run");
  });
  it("empty in, empty out", () => {
    expect(groupTrace([])).toEqual({ groups: [], verdict: null, done: null, explanation: null, diff: null });
  });
});

describe("labels", () => {
  it("known tools get a verb, unknown tools keep their real name", () => {
    expect(toolVerb("channel3.search")).toBe("Searched Channel3");
    expect(toolVerb("acme.frobnicate")).toBe("Ran acme.frobnicate");
  });
  it("collapsed summary de-duplicates tool names", () => {
    const g = groupTrace(LIVE).groups[2];
    expect(stepSummary(g)).toBe("Searched Channel3");
  });
  it("a group with an errored tool is degraded (red); the clean ones are not", () => {
    const gs = groupTrace(LIVE).groups;
    expect(gs.map(isDegraded)).toEqual([false, false, true]);
  });
  it("process counts", () => expect(processCounts(groupTrace(LIVE).groups)).toBe("3 agents · 2 tool calls"));
});

describe("durationFromLog", () => {
  it("uses only the latest attempt", () => {
    const log = [
      { attempt: 1, createdAtIso: "2026-11-09T10:00:00.000Z" },
      { attempt: 1, createdAtIso: "2026-11-09T10:05:00.000Z" },
      { attempt: 2, createdAtIso: "2026-11-09T11:00:00.000Z" },
      { attempt: 2, createdAtIso: "2026-11-09T11:00:01.500Z" },
    ];
    expect(durationFromLog(log)).toBe(1500);
  });
  it("no log → null", () => expect(durationFromLog([])).toBeNull());
});
