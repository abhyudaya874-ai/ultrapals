import { describe, expect, it } from "vitest";
import { toScheduler } from "./bryntum";

const row = (o: Partial<Parameters<typeof toScheduler>[0][number]> = {}) => ({
  id: "v1", promiseId: "p1", payer: "Asha", title: "Shoes", dueAtIso: "2026-11-10T10:00:00.000Z", state: "open" as const, amountMinor: 1250, currency: "USD", ...o,
});

describe("toScheduler", () => {
  it("one resource per payer, one event per promise", () => {
    const d = toScheduler([row(), row({ promiseId: "p2" }), row({ promiseId: "p3", payer: "Ravi" })]);
    expect(d.resources.map((r) => r.id)).toEqual(["Asha", "Ravi"]);
    expect(d.events).toHaveLength(3);
  });
  it("formats money from minor units and ends the bar at the due date", () => {
    const [e] = toScheduler([row()]).events;
    expect(e.name).toBe("Shoes · 12.50 USD");
    expect(e.endDate).toBe("2026-11-10T10:00:00.000Z");
    expect(e.startDate).toBe("2026-11-10T09:00:00.000Z");
  });
  it.each([["open", "pending"], ["capture_pending", "pending"], ["captured", "met"], ["released", "unmet"], ["declined", "unmet"]] as const)("%s -> %s", (state, cls) => {
    expect(toScheduler([row({ state })]).events[0].cls).toBe(cls);
  });
  it("keeps event ids unique when a promise has several verdict rows", () => {
    const d = toScheduler([row(), row({ id: "v2" })]);
    expect(d.events.map((e) => e.id)).toEqual(["v1", "v2"]);
    expect(d.events.every((e) => e.promiseId === "p1")).toBe(true);
  });
});
