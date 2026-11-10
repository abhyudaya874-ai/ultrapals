import { describe, expect, it } from "vitest";
import { Schedule } from "./core";
import { PRESETS, SUGGESTIONS, buildSchedule, nameFromPrompt, relative } from "./presets";

describe("buildSchedule", () => {
  it.each([["30m", 30], ["1h", 60], ["6h", 360], ["12h", 720]] as const)("%s is an interval of %i minutes and ignores the time", (id, m) => expect(buildSchedule(id, "07:15")).toEqual({ kind: "every", minutes: m }));
  it("daily, weekdays and weekends use the time and their days", () => {
    expect(buildSchedule("daily", "18:30")).toEqual({ kind: "daily", hour: 18, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] });
    expect(buildSchedule("weekdays", "8:05")).toEqual({ kind: "daily", hour: 8, minute: 5, days: [1, 2, 3, 4, 5] });
    expect(buildSchedule("weekends", "10:00")).toMatchObject({ days: [0, 6] });
  });
  it.each(["", "25:00", "09:61", "nine", "9"])("a bad time %j falls back to 09:00", (t) => expect(buildSchedule("daily", t)).toMatchObject({ hour: 9, minute: 0 }));
  it("every preset produces a schedule the server accepts", () => {
    for (const p of PRESETS) expect(Schedule.safeParse(buildSchedule(p.id, "09:00")).success).toBe(true);
  });
});

describe("nameFromPrompt", () => {
  it("uses the first line, collapses spaces and shortens a long one", () => {
    expect(nameFromPrompt("  Watch   the rails\nsecond line")).toBe("Watch the rails");
    const long = nameFromPrompt("x".repeat(80));
    expect(long).toHaveLength(48);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("relative", () => {
  const now = 10_000_000_000;
  it.each([
    [now + 10_000, "just now"],
    [now - 30_000, "just now"],
    [now + 5 * 60_000, "in 5 min"],
    [now - 2 * 60_000, "2 min ago"],
    [now + 5 * 3_600_000, "in 5 h"],
    [now - 26 * 3_600_000, "1 d ago"],
    [now + 3 * 86_400_000, "in 3 d"],
  ])("%i", (ms, want) => expect(relative(ms, now)).toBe(want));
});

describe("SUGGESTIONS", () => {
  it("each one is a valid prompt length and uses a real preset", () => {
    for (const s of SUGGESTIONS) {
      expect(s.prompt.length).toBeGreaterThan(3);
      expect(s.prompt.length).toBeLessThanOrEqual(1500);
      expect(PRESETS.some((p) => p.id === s.preset)).toBe(true);
    }
  });
});
