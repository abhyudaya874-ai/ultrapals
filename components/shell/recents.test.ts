import { describe, expect, it } from "vitest";
import { fromPromise, sortItems } from "./history";
import { stateLabel } from "./recents";

describe("stateLabel", () => {
  it.each([["open", "Waiting"], ["capture_pending", "Capturing"], ["captured", "Paid"], ["declined", "Declined"], ["released", "Released"], ["mystery", "mystery"]])("%s -> %s", (s, want) => expect(stateLabel(s)).toBe(want));
});

describe("promises in the history list", () => {
  const p = (id: string, createdAt: string) => fromPromise({ id, title: id, state: "open", amountMinor: 100, currency: "USD", createdAt });
  it("a promise with a date nobody can read sorts last when newest first, and a future one counts as today", () => {
    expect(sortItems([p("x", "nope"), p("a", "2026-11-10T09:00:00Z")], "newest").map((i) => i.id)).toEqual(["a", "x"]);
    expect(p("x", "nope").at).toBe(0);
  });
});
