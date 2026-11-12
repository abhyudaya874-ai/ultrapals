import { describe, expect, it } from "vitest";
import { DAY_MS, FORGET_MS, confirm, newLedger, release, reserve } from "./ledger";

const lim = { concurrent: 2, perDay: 5 };

describe("reserve: at most `concurrent` alive at once", () => {
  it("lets places be taken up to the limit, then says why not", () => {
    const l = newLedger();
    expect(reserve(l, 0, lim, "a")).toEqual({ ok: true });
    expect(reserve(l, 1, lim, "b")).toEqual({ ok: true });
    const r = reserve(l, 2, lim, "c");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toMatch(/2 cloud computers are already running.*limit for this demo \(2\)/);
  });
  it("a refused request takes nothing", () => {
    const l = newLedger();
    reserve(l, 0, { concurrent: 1, perDay: 5 }, "a");
    reserve(l, 1, { concurrent: 1, perDay: 5 }, "b");
    expect([...l.alive.keys()]).toEqual(["a"]);
    expect(l.started).toHaveLength(1);
  });
  it("gives a place back when the thing is closed, so the next one can start", () => {
    const l = newLedger();
    reserve(l, 0, lim, "a");
    reserve(l, 1, lim, "b");
    release(l, "a");
    expect(reserve(l, 2, lim, "c")).toEqual({ ok: true });
  });
  it("forgets a browser nobody closed once KERNEL must have deleted it", () => {
    const l = newLedger();
    reserve(l, 0, { concurrent: 1, perDay: 50 }, "a");
    expect(reserve(l, FORGET_MS, { concurrent: 1, perDay: 50 }, "b").ok).toBe(false); // exactly at the edge it is still counted
    expect(reserve(l, FORGET_MS + 1, { concurrent: 1, perDay: 50 }, "b")).toEqual({ ok: true });
    expect([...l.alive.keys()]).toEqual(["b"]);
  });
});

describe("reserve: at most `perDay` started in any 24 hours", () => {
  it("counts every start, even ones already closed", () => {
    const l = newLedger();
    for (let i = 0; i < 5; i++) {
      expect(reserve(l, i, { concurrent: 9, perDay: 5 }, `k${i}`)).toEqual({ ok: true });
      release(l, `k${i}`);
    }
    const r = reserve(l, 10, { concurrent: 9, perDay: 5 }, "k5");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toMatch(/budget of 5 cloud computers is used up/);
  });
  it("a start that failed still counts for the day, because it may have created something that bills", () => {
    const l = newLedger();
    reserve(l, 0, { concurrent: 9, perDay: 1 }, "k");
    release(l, "k"); // the start failed
    expect(reserve(l, 1, { concurrent: 9, perDay: 1 }, "k2").ok).toBe(false);
  });
  it("frees up as the window rolls, one start at a time", () => {
    const l = newLedger();
    const big = { concurrent: 99, perDay: 2 };
    reserve(l, 0, big, "a");
    reserve(l, 1000, big, "b");
    expect(reserve(l, DAY_MS - 1, big, "c").ok).toBe(false);
    expect(reserve(l, DAY_MS, big, "c")).toEqual({ ok: true }); // the first start is exactly a day old: it no longer counts
    expect(reserve(l, DAY_MS + 1, big, "d").ok).toBe(false); // the second is still inside the day
    expect(reserve(l, DAY_MS + 1000, big, "d")).toEqual({ ok: true });
  });
});

describe("confirm and release", () => {
  it("confirm moves the place to the real id, keeping when it started, so closing by id gives it back", () => {
    const l = newLedger();
    reserve(l, 7, { concurrent: 1, perDay: 9 }, "key");
    confirm(l, "key", "session-1");
    expect(l.alive.get("session-1")).toBe(7);
    expect(l.alive.has("key")).toBe(false);
    release(l, "session-1");
    expect(reserve(l, 8, { concurrent: 1, perDay: 9 }, "k2")).toEqual({ ok: true });
  });
  it("confirm for a key that is gone, and release for an unknown id, do nothing", () => {
    const l = newLedger();
    confirm(l, "nope", "x");
    release(l, "nope");
    expect(l.alive.size).toBe(0);
  });
});
