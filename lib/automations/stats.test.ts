import { describe, expect, it } from "vitest";
import { activityGrid, amountPoints, latestPerPromise, moneyFlow, type FlowRow } from "@/lib/charts/flow";
import { DAY, dayStart, durationPoints, kpis, runGrid, upcomingRuns } from "./stats";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const run = (iso: string, status: "ok" | "error" = "ok", ms = 5000) => ({ atMs: Date.parse(iso), ms, status });

describe("runGrid", () => {
  const autos = [{ name: "Digest", runs: [run("2026-11-10T09:00:00Z"), run("2026-11-10T10:00:00Z", "error"), run("2026-11-08T01:00:00Z")] }, { name: "Empty", runs: [] }];
  const g = runGrid(autos, NOW, 5);
  it("has one column per day, oldest first, labelled", () => expect(g.cols).toEqual(["Nov 6", "Nov 7", "Nov 8", "Nov 9", "Nov 10"]));
  it("is the share of successful runs that day, null when none", () => {
    expect(g.values[0]).toEqual([null, null, 1, null, 0.5]);
    expect(g.counts[0]).toEqual([0, 0, 1, 0, 2]);
    expect(g.values[1].every((v) => v === null)).toBe(true);
  });
  it("ignores runs outside the window", () => expect(runGrid([{ name: "x", runs: [run("2026-10-01T00:00:00Z")] }], NOW, 5).values[0]).toEqual([null, null, null, null, null]));
  it("keeps the automation order", () => expect(g.rows).toEqual(["Digest", "Empty"]));
});

describe("durationPoints / kpis", () => {
  it("durations are seconds with one decimal", () => expect(durationPoints([{ name: "a", runs: [run("2026-11-10T00:00:00Z", "ok", 29072)] }])).toEqual([{ t: Date.parse("2026-11-10T00:00:00Z"), v: 29.1 }]));
  const autos = [
    { name: "A", enabled: true, nextRunMs: NOW + 3_600_000, runs: [run("2026-11-10T09:00:00Z"), run("2026-11-10T08:00:00Z", "error"), run("2026-11-01T00:00:00Z")] },
    { name: "B", enabled: false, nextRunMs: null, runs: [] },
    { name: "C", enabled: true, nextRunMs: NOW + 600_000, runs: [] },
  ];
  it("counts only the last 24 hours and finds the soonest run", () => {
    expect(kpis(autos, NOW)).toEqual({ active: 2, total: 3, runs24h: 2, ok24h: 1, failed24h: 1, successRate: 0.5, next: { name: "C", at: NOW + 600_000 } });
  });
  it("no runs means no rate, not 0%", () => expect(kpis([autos[1]], NOW)).toMatchObject({ successRate: null, next: null }));
});

describe("upcomingRuns", () => {
  const a = { schedule: { kind: "every" as const, minutes: 120 }, tzOffsetMin: 0, nextRunMs: NOW + 1000, enabled: true };
  it("steps through the window from the recorded next run", () => expect(upcomingRuns(a, NOW, NOW + 5 * 3_600_000)).toEqual([NOW + 1000, NOW + 1000 + 7_200_000, NOW + 1000 + 14_400_000]));
  it("a paused or unscheduled automation has none", () => {
    expect(upcomingRuns({ ...a, enabled: false }, NOW, NOW + DAY)).toEqual([]);
    expect(upcomingRuns({ ...a, nextRunMs: null }, NOW, NOW + DAY)).toEqual([]);
  });
  it("is capped, so a frequent schedule over a long window stays small", () => expect(upcomingRuns({ ...a, schedule: { kind: "every", minutes: 30 } }, NOW, NOW + 30 * DAY, 25)).toHaveLength(25));
  it("an overdue next run is shown from the start of the window", () => expect(upcomingRuns({ ...a, nextRunMs: NOW - DAY }, NOW, NOW + DAY)[0]).toBe(NOW));
  it("dayStart is UTC midnight", () => expect(dayStart(NOW)).toBe(Date.parse("2026-11-10T00:00:00Z")));
});

const row = (promiseId: string, state: string, amountMinor: number, at: string, currency = "USD"): FlowRow => ({ promiseId, state, amountMinor, currency, at });
describe("money flow", () => {
  const rows = [row("p1", "open", 1000, "2026-11-01T00:00:00Z"), row("p1", "captured", 1000, "2026-11-02T00:00:00Z"), row("p2", "released", 500, "2026-11-03T00:00:00Z"), row("p3", "declined", 250, "2026-11-04T00:00:00Z"), row("p4", "capture_pending", 100, "2026-11-05T00:00:00Z"), row("p5", "captured", 9999, "2026-11-05T00:00:00Z", "EUR")];
  it("uses each promise's newest state only", () => expect(latestPerPromise(rows).map((r) => [r.promiseId, r.state]).sort()).toEqual([["p1", "captured"], ["p2", "released"], ["p3", "declined"], ["p4", "capture_pending"], ["p5", "captured"]]));
  it("splits what was promised into captured, released, declined and still open, in one currency", () => {
    const f = moneyFlow(rows);
    expect(f).toMatchObject({ currency: "USD", skipped: 1, promised: 1850, captured: 1000, released: 500, declined: 250, open: 100 });
    expect(f.captured + f.released + f.declined + f.open).toBe(f.promised);
  });
  it("no rows is zeros in USD", () => expect(moneyFlow([])).toMatchObject({ currency: "USD", promised: 0, skipped: 0 }));
  it("an unknown state counts as still open", () => expect(moneyFlow([row("p", "weird", 7, "2026-11-01T00:00:00Z")])).toMatchObject({ open: 7, promised: 7 }));
  it("amount points are in major units for one currency only", () => expect(amountPoints(rows, "USD")).toHaveLength(5));
  it("the activity grid counts by UTC weekday and hour", () => {
    const g = activityGrid([{ at: "2026-11-10T09:30:00Z" }, { at: "2026-11-10T09:59:00Z" }, { at: "2026-11-09T23:00:00Z" }, { at: "bad" }]);
    expect(g[2][9]).toBe(2); // 2026-11-10 is a Tuesday
    expect(g[1][23]).toBe(1);
    expect(g.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
});
