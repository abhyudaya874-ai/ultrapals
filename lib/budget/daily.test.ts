import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimit } from "@/lib/research/rate-limit";
import { DAY_MS, dailyGate, personalShare } from "./daily";

const caps = { run: 8, contest: 4 };
beforeEach(resetRateLimit);

describe("personalShare", () => {
  it("is a quarter of the day, rounded up, and never zero", () => {
    expect(personalShare(250)).toBe(63);
    expect(personalShare(30)).toBe(8);
    expect(personalShare(1)).toBe(1);
  });
});

describe("dailyGate: messages", () => {
  it("lets one person use their share and then turns them away, saying how much that was", () => {
    for (let i = 0; i < 2; i++) expect(dailyGate("a", "run", caps, i)).toEqual({ ok: true });
    const r = dailyGate("a", "run", caps, 3);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/your share of today's demo \(2 messages\)/);
  });
  it("one person cannot use up the day for everyone else", () => {
    for (let i = 0; i < 20; i++) dailyGate("hog", "run", caps, i);
    expect(dailyGate("other", "run", caps, 50)).toEqual({ ok: true });
  });
  it("stops everyone once the whole server's cap is reached, and says so", () => {
    let last: ReturnType<typeof dailyGate> = { ok: true };
    for (const who of ["a", "b", "c", "d", "e"]) for (let i = 0; i < 2; i++) last = dailyGate(who, "run", caps, 1);
    expect(last.ok).toBe(false); // 8 allowed in total; the 9th is turned away
    expect(last.ok === false && last.error).toMatch(/budget \(8 messages\) is used up for everyone/);
    expect(last.ok === false && last.retryAfterSec).toBeGreaterThan(0);
  });
  it("a person turned away does not use up what is left for others", () => {
    for (let i = 0; i < 2; i++) dailyGate("a", "run", caps, i);
    for (let i = 0; i < 50; i++) dailyGate("a", "run", caps, 10 + i); // refused every time
    for (const who of ["b", "c", "d"]) for (let i = 0; i < 2; i++) expect(dailyGate(who, "run", caps, 100)).toEqual({ ok: true });
  });
  it("frees up as the day rolls over", () => {
    for (let i = 0; i < 2; i++) dailyGate("a", "run", caps, 0);
    expect(dailyGate("a", "run", caps, DAY_MS - 1).ok).toBe(false);
    expect(dailyGate("a", "run", caps, DAY_MS)).toEqual({ ok: true });
  });
});

describe("dailyGate: Battles and Loops count separately and are rarer", () => {
  it("has its own cap, which messages do not touch", () => {
    for (let i = 0; i < 8; i++) dailyGate("a", "run", caps, i);
    expect(dailyGate("a", "contest", caps, 9)).toEqual({ ok: true });
  });
  it("names them in the message", () => {
    dailyGate("a", "contest", caps, 0);
    const r = dailyGate("a", "contest", caps, 1);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/\(1 Battles and Loops\)/);
  });
});
