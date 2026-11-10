import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, dateBucket, groupItems, parsePrefs, sortItems, splitPinned, stateLabel, togglePin, type Item } from "./recents";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const it_ = (id: string, title: string, createdAt: string, o: Partial<Item> = {}): Item => ({ id, title, state: "open", amountMinor: 100, currency: "USD", createdAt, ...o });
const items = [
  it_("a", "Unlock story 10", "2026-11-10T09:00:00Z", { amountMinor: 1 }),
  it_("b", "unlock story 2", "2026-11-09T23:59:00Z", { state: "captured", amountMinor: 500 }),
  it_("c", "Probe", "2026-11-05T10:00:00Z", { state: "declined", amountMinor: 20 }),
  it_("d", "Zebra", "2026-10-01T10:00:00Z", { state: "captured", amountMinor: 20 }),
];

describe("sortItems", () => {
  it.each([["newest", "abcd"], ["oldest", "dcba"], ["name", "cbad"], ["amount", "bcda"]] as const)("%s", (by, want) => expect(sortItems(items, by).map((i) => i.id).join("")).toBe(want));
  it("names sort naturally and ignoring case (story 2 before story 10)", () => expect(sortItems(items, "name").map((i) => i.title).slice(1, 3)).toEqual(["unlock story 2", "Unlock story 10"]));
  it("does not change the input", () => { const copy = [...items]; sortItems(items, "name"); expect(items).toEqual(copy); });
  it("a bad date sorts last when newest first", () => expect(sortItems([it_("x", "x", "nope"), ...items], "newest").at(-1)!.id).toBe("x"));
});

describe("dateBucket", () => {
  it.each([["2026-11-10T00:00:01Z", "Today"], ["2026-11-10T23:59:00Z", "Today"], ["2026-11-09T23:59:00Z", "Yesterday"], ["2026-11-04T12:00:00Z", "Previous 7 days"], ["2026-11-03T12:00:00Z", "Earlier"], ["2026-10-01T00:00:00Z", "Earlier"], ["garbage", "Earlier"], ["2026-11-12T00:00:00Z", "Today"]])("%s -> %s", (iso, want) => expect(dateBucket(iso, NOW)).toBe(want));
});

describe("groupItems", () => {
  it("none is one unlabeled group, or nothing for an empty list", () => {
    expect(groupItems(items, "none", NOW)).toEqual([{ label: "", items }]);
    expect(groupItems([], "none", NOW)).toEqual([]);
  });
  it("date groups come in calendar order and skip empty ones", () => {
    expect(groupItems(items, "date", NOW).map((g) => [g.label, g.items.map((i) => i.id).join("")])).toEqual([["Today", "a"], ["Yesterday", "b"], ["Previous 7 days", "c"], ["Earlier", "d"]]);
  });
  it("state groups put what needs attention first, with readable names", () => {
    expect(groupItems(items, "state", NOW).map((g) => g.label)).toEqual(["Waiting", "Paid", "Declined"]);
    expect(stateLabel("capture_pending")).toBe("Capturing");
    expect(stateLabel("mystery")).toBe("mystery");
  });
  it("an unknown state still appears, after the known ones", () => expect(groupItems([...items, it_("e", "e", "2026-11-10T00:00:00Z", { state: "mystery" })], "state", NOW).at(-1)!.label).toBe("mystery"));
});

describe("pins", () => {
  it("pinned items come first in pin order; a stale pin is ignored", () => {
    const s = splitPinned(items, ["c", "gone", "a"]);
    expect(s.pinned.map((i) => i.id)).toEqual(["c", "a"]);
    expect(s.rest.map((i) => i.id)).toEqual(["b", "d"]);
  });
  it("toggle adds at the end and removes", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePin(Array.from({ length: 50 }, (_, i) => `p${i}`), "new")).toHaveLength(50);
  });
});

describe("parsePrefs", () => {
  it.each([[null], ["nope"], ["{}"], ['{"sort":"sideways","group":7}']])("%j -> defaults", (raw) => expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS));
  it("keeps valid values and drops junk pins", () => {
    expect(parsePrefs('{"sort":"name","group":"state","pinned":["a",3,null],"open":false}')).toEqual({ sort: "name", group: "state", pinned: ["a"], open: false });
  });
});
