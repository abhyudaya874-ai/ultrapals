import { describe, expect, it } from "vitest";
import { DAILY_RUN_CAP, STALE_RUN_MS, Spec, asksForSchedule, canStart, describeSchedule, isDue, newAutomation, nextRunAfter, parseSchedule, scheduleNext, type Schedule } from "./core";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const daily = (hour: number, minute = 0, days = [0, 1, 2, 3, 4, 5, 6]): Schedule => ({ kind: "daily", hour, minute, days });
const spec = (o: Partial<Spec> = {}): Spec => Spec.parse({ name: "Digest", prompt: "Summarise the news", schedule: { kind: "every", minutes: 60 }, ...o });

describe("nextRunAfter", () => {
  it("every N minutes counts from the moment given", () => expect(nextRunAfter({ kind: "every", minutes: 90 }, 0, at("2026-11-10T10:00:00Z"))).toBe(at("2026-11-10T11:30:00Z")));
  it.each([
    ["before today's time -> today", daily(9), 0, "2026-11-10T08:00:00Z", "2026-11-10T09:00:00.000Z"],
    ["exactly at the time -> tomorrow (strictly after)", daily(9), 0, "2026-11-10T09:00:00Z", "2026-11-11T09:00:00.000Z"],
    ["after today's time -> tomorrow", daily(9), 0, "2026-11-10T17:45:00Z", "2026-11-11T09:00:00.000Z"],
    ["east of UTC: 09:00 in +05:30 is 03:30Z", daily(9), 330, "2026-11-10T00:00:00Z", "2026-11-10T03:30:00.000Z"],
    ["west of UTC: 22:00 in -08:00 is 06:00Z next day", daily(22), -480, "2026-11-10T05:00:00Z", "2026-11-10T06:00:00.000Z"],
    ["weekdays skip the weekend (Fri -> Mon)", daily(9, 0, [1, 2, 3, 4, 5]), 0, "2026-11-06T10:00:00Z", "2026-11-09T09:00:00.000Z"],
    ["one chosen day is found a week ahead", daily(9, 0, [2]), 0, "2026-11-10T10:00:00Z", "2026-11-17T09:00:00.000Z"],
    ["a local date that differs from the UTC date uses the local weekday (local Wednesday 06:00 has passed 01:00, so next Wednesday)", daily(1, 0, [3]), 600, "2026-11-10T20:00:00Z", "2026-11-17T15:00:00.000Z"],
  ])("daily: %s", (_n, s, tz, after, want) => expect(iso(nextRunAfter(s, tz, at(after)))).toBe(want));
  it("never returns a time at or before the one given, for every minute of a day and every offset", () => {
    for (const tz of [-840, -330, 0, 345, 840]) for (let m = 0; m < 1440; m += 37) {
      const after = at("2026-03-29T00:00:00Z") + m * 60_000; // a day with a typical DST change somewhere; the stored offset is fixed so none applies here
      expect(nextRunAfter(daily(m % 24, m % 60), tz, after)).toBeGreaterThan(after);
    }
  });
});

describe("describeSchedule", () => {
  it.each([
    [{ kind: "every", minutes: 30 }, "Every 30 minutes"],
    [{ kind: "every", minutes: 60 }, "Every hour"],
    [{ kind: "every", minutes: 360 }, "Every 6 hours"],
    [{ kind: "every", minutes: 1440 }, "Every day"],
    [{ kind: "every", minutes: 2880 }, "Every 2 days"],
    [daily(9), "Daily at 09:00"],
    [daily(18, 5, [1, 2, 3, 4, 5]), "Weekdays at 18:05"],
    [daily(8, 30, [0, 6]), "Weekends at 08:30"],
    [daily(7, 0, [4, 1]), "Mon, Thu at 07:00"],
  ] as [Schedule, string][])("%j", (s, want) => expect(describeSchedule(s)).toBe(want));
});

describe("Spec", () => {
  it.each([
    ["an interval under 30 minutes", { schedule: { kind: "every", minutes: 29 } }],
    ["an interval over a week", { schedule: { kind: "every", minutes: 7 * 1440 + 1 } }],
    ["hour 24", { schedule: daily(24) }],
    ["no days", { schedule: daily(9, 0, []) }],
    ["an empty name", { name: "  " }],
    ["a one-character prompt", { prompt: "x" }],
    ["an unknown level", { level: "turbo" }],
    ["an impossible time zone", { tzOffsetMin: 900 }],
  ])("refuses %s", (_n, o) => expect(Spec.safeParse({ name: "n", prompt: "do something", schedule: { kind: "every", minutes: 60 }, ...o }).success).toBe(false));
  it("fills the defaults", () => expect(spec()).toMatchObject({ level: "standard", enabled: true, tzOffsetMin: 0 }));
});

describe("running rules", () => {
  const base = () => newAutomation(spec(), "a1", at("2026-11-10T10:00:00Z"));
  it("a new automation is scheduled one interval ahead; a paused one has no next run", () => {
    expect(iso(base().nextRunMs!)).toBe("2026-11-10T11:00:00.000Z");
    expect(newAutomation(spec({ enabled: false }), "a2", 0).nextRunMs).toBeNull();
  });
  it("is due only once its time has come", () => {
    const a = base();
    expect(isDue(a, a.nextRunMs! - 1)).toBe(false);
    expect(isDue(a, a.nextRunMs!)).toBe(true);
  });
  it("paused automations are never due", () => expect(isDue({ ...base(), enabled: false }, at("2027-01-01T00:00:00Z"))).toBe(false));
  it("a running one is not started twice, but a stale claim (server died) is", () => {
    const a = { ...base(), runningSince: 1000 };
    expect(canStart(a, 1000 + STALE_RUN_MS - 1)).toMatchObject({ ok: false, why: "it is already running" });
    expect(canStart(a, 1000 + STALE_RUN_MS)).toEqual({ ok: true });
  });
  it("stops at the daily cap and frees up as runs age out", () => {
    const now = at("2026-11-10T12:00:00Z");
    const log = Array.from({ length: DAILY_RUN_CAP }, (_, i) => now - i * 60_000);
    expect(canStart({ ...base(), runLog: log }, now)).toMatchObject({ ok: false });
    expect(canStart({ ...base(), runLog: log }, now + 24 * 3_600_000)).toEqual({ ok: true });
  });
  it("after a long outage the next run is counted from now, not replayed", () => {
    const a = base();
    expect(iso(scheduleNext(a, at("2026-11-20T00:00:00Z")))).toBe("2026-11-20T01:00:00.000Z");
  });
});

describe("parseSchedule", () => {
  it.each([
    ["hourly", { kind: "every", minutes: 60 }],
    ["Every hour", { kind: "every", minutes: 60 }],
    ["every 6 hours", { kind: "every", minutes: 360 }],
    ["every 90 minutes", { kind: "every", minutes: 90 }],
    ["every 2 days", { kind: "every", minutes: 2880 }],
    ["daily 09:00", daily(9)],
    ["daily at 8:30", daily(8, 30)],
    ["weekdays 18:00", daily(18, 0, [1, 2, 3, 4, 5])],
    ["weekends at 10:15", daily(10, 15, [0, 6])],
  ])("reads %j", (text, want) => expect(parseSchedule(text)).toEqual(want));
  it.each(["every 5 minutes", "every 0 hours", "every 9999 hours", "daily 25:00", "daily 09:60", "whenever", "", "every minute", "mondays 09:00", "every 3 weeks"])("refuses %j rather than guessing", (t) => expect(parseSchedule(t)).toBeNull());
});

describe("asksForSchedule", () => {
  it.each([
    "check this every morning",
    "Run it daily",
    "make this an automation",
    "keep watching the price",
    "remind me weekly",
    "schedule a weekly digest",
    "automate the sandbox check",
  ])("%j asks for a schedule", (m) => expect(asksForSchedule(m)).toBe(true));
  it.each(["compare PayPal and Stripe", "what happened yesterday", "summarise this page", "build a landing page", "everyone wins"])("%j does not", (m) => expect(asksForSchedule(m)).toBe(false));
});
