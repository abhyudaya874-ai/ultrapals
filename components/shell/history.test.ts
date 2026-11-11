import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, GROUPS, SORTS, ago, bulkPlan, countsByKind, dateBucket, filterItems, fromAutomation, fromConvo, fromPromise, groupItems, parsePrefs, pinBulk, sortItems, splitPinned, toggleKey, toggleKind, togglePin, type BriefAutomation, type ConvoMeta, type HItem } from "./history";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const DAY = 86_400_000;
const promise = (o: Partial<Parameters<typeof fromPromise>[0]> = {}) => fromPromise({ id: "p1", title: "Pay the designer", state: "open", amountMinor: 1250, currency: "USD", createdAt: "2026-11-10T09:00:00Z", ...o });
const brief = (o: Partial<BriefAutomation> = {}): BriefAutomation => ({ id: "a1", name: "Fee watch", kind: "watch", count: null, enabled: true, running: false, scheduleText: "Daily at 09:00", createdAtMs: NOW - 5 * DAY, lastRunMs: NOW - 3_600_000, last: "ok", blocked: false, ...o });
const convo = (o: Partial<ConvoMeta> = {}): ConvoMeta => ({ id: "c1", title: "Compare the rails", kinds: ["chat"], createdAt: NOW - 2 * DAY, updatedAt: NOW - 1000, runs: 3, status: "done", ...o });

describe("rows from each source", () => {
  it("a promise: amount and state in the hint, a dot for its state, never deletable (its history is the audit log)", () => {
    expect(promise()).toMatchObject({ key: "promise:p1", kind: "promise", kinds: ["promise"], status: "Waiting", tone: "warn", hint: "12.50 USD · Waiting", amountMinor: 1250, deletable: false, renamable: false });
    expect(promise({ state: "captured" })).toMatchObject({ status: "Paid", tone: "ok" });
    expect(promise({ state: "declined" })).toMatchObject({ tone: "bad" });
    expect(promise({ state: "mystery" })).toMatchObject({ status: "mystery", tone: "rest" });
  });
  it("a promise in a currency the app cannot format shows no amount rather than a wrong one", () => expect(promise({ currency: "XYZ" }).hint).toBe("Waiting"));
  it("an automation: on, running, paused, failed or needing a person", () => {
    expect(fromAutomation(brief())).toMatchObject({ key: "automation:a1", kind: "automation", status: "On", tone: "ok", deletable: true, renamable: false });
    expect(fromAutomation(brief({ running: true }))).toMatchObject({ status: "Running", tone: "live" });
    expect(fromAutomation(brief({ enabled: false }))).toMatchObject({ status: "Paused", tone: "rest" });
    expect(fromAutomation(brief({ last: "error" }))).toMatchObject({ status: "Failed", tone: "bad" });
    expect(fromAutomation(brief({ blocked: true }))).toMatchObject({ status: "Needs you", tone: "warn" });
    expect(fromAutomation(brief({ running: true, last: "error" })).status).toBe("Running"); // a run in progress beats the last result
  });
  it("an automation says what kind it is and its schedule; a Battle says how many teams", () => {
    expect(fromAutomation(brief()).hint).toBe("Page watch · Daily at 09:00");
    expect(fromAutomation(brief({ kind: "battle", count: 3, scheduleText: "Every 6 hours" })).hint).toBe("Battle · 3 teams · Every 6 hours");
    expect(fromAutomation(brief({ kind: "loop", count: 2, scheduleText: "Every day" })).hint).toBe("Loop · 2 rounds · Every day");
  });
  it("an automation counts as changed when it last ran, or when it was made if it never ran", () => {
    expect(fromAutomation(brief()).at).toBe(NOW - 3_600_000);
    expect(fromAutomation(brief({ lastRunMs: null })).at).toBe(NOW - 5 * DAY);
  });
  it("a chat, a battle and a loop", () => {
    expect(fromConvo(convo())).toMatchObject({ key: "convo:c1", kind: "chat", kinds: ["chat"], status: "Done", tone: "rest", hint: "3 messages", deletable: true, renamable: true });
    expect(fromConvo(convo({ kinds: ["battle"], runs: 1 }))).toMatchObject({ kind: "battle", hint: "1 message" });
    expect(fromConvo(convo({ kinds: ["loop"] })).kind).toBe("loop");
    expect(fromConvo(convo({ status: "running" }))).toMatchObject({ status: "Running", tone: "live" });
    expect(fromConvo(convo({ status: "waiting" }))).toMatchObject({ status: "Needs you", tone: "warn" });
    expect(fromConvo(convo({ status: "error" }))).toMatchObject({ status: "Failed", tone: "bad" });
  });
  it("a chat in which a Battle was run shows as a chat but is found under Battles too", () => {
    const i = fromConvo(convo({ kinds: ["chat", "battle"] }));
    expect(i.kind).toBe("chat");
    expect(filterItems([i], ["battle"])).toHaveLength(1);
    expect(filterItems([i], ["loop"])).toHaveLength(0);
  });
});

describe("filter", () => {
  const items = [fromConvo(convo()), fromConvo(convo({ id: "c2", title: "Rail battle", kinds: ["battle"] })), fromAutomation(brief()), promise()];
  it("no kinds means all", () => expect(filterItems(items, [])).toHaveLength(4));
  it("one kind, or several", () => {
    expect(filterItems(items, ["automation"]).map((i) => i.id)).toEqual(["a1"]);
    expect(filterItems(items, ["chat", "promise"]).map((i) => i.id)).toEqual(["c1", "p1"]);
  });
  it("by words in the title, ignoring case", () => expect(filterItems(items, [], " RAIL ").map((i) => i.id)).toEqual(["c1", "c2"]));
  it("toggling a kind adds it, then removes it", () => {
    expect(toggleKind([], "loop")).toEqual(["loop"]);
    expect(toggleKind(["loop", "chat"], "loop")).toEqual(["chat"]);
  });
  it("counts rows per kind, a mixed chat once for each kind it holds", () => {
    expect(countsByKind([fromConvo(convo({ kinds: ["chat", "battle"] })), fromConvo(convo({ id: "c3", kinds: ["chat"] })), promise()])).toEqual({ chat: 2, battle: 1, loop: 0, automation: 0, promise: 1 });
  });
});

describe("sort", () => {
  const a = { ...promise({ id: "p1", title: "Zeta", amountMinor: 500, createdAt: "2026-11-08T00:00:00Z" }) };
  const b = { ...promise({ id: "p2", title: "alpha", amountMinor: 9000, createdAt: "2026-11-10T00:00:00Z" }) };
  const c = fromConvo(convo({ title: "Middle 10", updatedAt: Date.parse("2026-11-09T00:00:00Z") }));
  const d = fromConvo(convo({ id: "c9", title: "Middle 9", updatedAt: Date.parse("2026-11-07T00:00:00Z") }));
  it("newest, oldest", () => {
    expect(sortItems([a, b, c], "newest").map((i) => i.id)).toEqual(["p2", "c1", "p1"]);
    expect(sortItems([a, b, c], "oldest").map((i) => i.id)).toEqual(["p1", "c1", "p2"]);
  });
  it("by name, ignoring case and counting numbers as numbers", () => expect(sortItems([a, b, c, d], "name").map((i) => i.title)).toEqual(["alpha", "Middle 9", "Middle 10", "Zeta"]));
  it("by amount puts rows with no amount last, newest first among them", () => expect(sortItems([c, a, d, b], "amount").map((i) => i.id)).toEqual(["p2", "p1", "c1", "c9"]));
  it("never changes the list it was given", () => {
    const list = [a, b];
    sortItems(list, "name");
    expect(list.map((i) => i.id)).toEqual(["p1", "p2"]);
  });
  it("every sort and group offered has a label", () => {
    for (const s of SORTS) expect(s.label.length).toBeGreaterThan(2);
    for (const g of GROUPS) expect(g.label.length).toBeGreaterThan(2);
  });
});

describe("group", () => {
  const at = (ms: number) => ({ ...fromConvo(convo({ id: `c${ms}`, updatedAt: ms })) });
  it("none is one unlabelled group, and an empty list has none", () => {
    expect(groupItems([at(NOW)], "none", NOW)).toEqual([{ label: "", items: [at(NOW)] }]);
    expect(groupItems([], "none", NOW)).toEqual([]);
  });
  it.each([
    [NOW - 1000, "Today"],
    [NOW - DAY, "Yesterday"],
    [NOW - 3 * DAY, "Previous 7 days"],
    [NOW - 9 * DAY, "Earlier"],
    [0, "Earlier"],
  ])("date: %i is %s", (ms, label) => expect(dateBucket(ms, NOW)).toBe(label));
  it("by date, newest buckets first", () => {
    expect(groupItems([at(NOW - 9 * DAY), at(NOW - 100), at(NOW - DAY)], "date", NOW).map((g) => g.label)).toEqual(["Today", "Yesterday", "Earlier"]);
  });
  it("by type, in the order Chats, Battles, Loops, Automations, Promises", () => {
    const rows = [promise(), fromAutomation(brief()), fromConvo(convo({ kinds: ["loop"], id: "l" })), fromConvo(convo({ kinds: ["battle"], id: "b" })), fromConvo(convo())];
    expect(groupItems(rows, "type", NOW).map((g) => g.label)).toEqual(["Chats", "Battles", "Loops", "Automations", "Promises"]);
  });
  it("by status, what needs attention first, a status it does not know after the rest", () => {
    const rows = [fromConvo(convo()), fromConvo(convo({ id: "r", status: "running" })), fromConvo(convo({ id: "e", status: "error" })), promise({ state: "mystery" })];
    expect(groupItems(rows, "status", NOW).map((g) => g.label)).toEqual(["Running", "Failed", "Done", "mystery"]);
  });
  it("keeps the incoming order inside a group", () => {
    const rows = [at(NOW - 300), at(NOW - 100), at(NOW - 200)];
    expect(groupItems(rows, "date", NOW)[0].items.map((i) => i.at)).toEqual([NOW - 300, NOW - 100, NOW - 200]);
  });
});

describe("pins", () => {
  const rows = [promise({ id: "p1" }), fromConvo(convo()), fromAutomation(brief())];
  it("pinned rows come first in the order they were pinned; a pin for a row that is gone is ignored", () => {
    const r = splitPinned(rows, ["automation:a1", "convo:gone", "promise:p1"]);
    expect(r.pinned.map((i) => i.key)).toEqual(["automation:a1", "promise:p1"]);
    expect(r.rest.map((i) => i.key)).toEqual(["convo:c1"]);
  });
  it("toggles, the newest pin last, at most fifty", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePin(Array.from({ length: 50 }, (_, i) => `k${i}`), "new")).toHaveLength(50);
    expect(togglePin(Array.from({ length: 50 }, (_, i) => `k${i}`), "new").at(-1)).toBe("new");
  });
  it("pinning a selection pins them all, or unpins them all when every one was pinned already", () => {
    expect(pinBulk(["x"], rows)).toEqual(["x", "promise:p1", "convo:c1", "automation:a1"]);
    expect(pinBulk(["promise:p1", "convo:c1", "automation:a1", "x"], rows)).toEqual(["x"]);
    expect(pinBulk(["promise:p1"], rows)).toEqual(["promise:p1", "convo:c1", "automation:a1"]); // one was pinned, the others are not: all become pinned
    expect(pinBulk(["x"], [])).toEqual(["x"]);
  });
});

describe("selecting rows", () => {
  const rows: HItem[] = [promise({ id: "p1" }), fromConvo(convo()), fromAutomation(brief())];
  it("toggles a row in and out", () => {
    expect(toggleKey([], "a")).toEqual(["a"]);
    expect(toggleKey(["a", "b"], "a")).toEqual(["b"]);
  });
  it("says which chosen rows can be deleted: a promise cannot", () => {
    const p = bulkPlan(rows, ["promise:p1", "convo:c1", "automation:a1", "convo:gone"]);
    expect(p.chosen.map((i) => i.key)).toEqual(["promise:p1", "convo:c1", "automation:a1"]); // a row that is no longer listed is not counted
    expect(p.deletable.map((i) => i.key)).toEqual(["convo:c1", "automation:a1"]);
    expect(p.kept.map((i) => i.key)).toEqual(["promise:p1"]);
  });
  it("nothing chosen deletes nothing", () => expect(bulkPlan(rows, [])).toMatchObject({ chosen: [], deletable: [], kept: [] }));
});

describe("saved preferences", () => {
  it("fall back to the defaults for anything that is not valid", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ sort: "sideways", group: "nope", kinds: ["chat", "teleport", "chat"], pinned: [5, "ok:1"], open: false }))).toEqual({ sort: "newest", group: "none", kinds: ["chat"], pinned: ["ok:1"], open: false });
  });
  it("read a list saved by the promises-only sidebar: bare ids are promises, 'state' is 'status'", () => {
    expect(parsePrefs(JSON.stringify({ sort: "amount", group: "state", pinned: ["abc", "convo:x"], open: true }))).toEqual({ sort: "amount", group: "status", kinds: [], pinned: ["promise:abc", "convo:x"], open: true });
  });
  it("keep at most fifty pins", () => expect(parsePrefs(JSON.stringify({ pinned: Array.from({ length: 80 }, (_, i) => `promise:${i}`) })).pinned).toHaveLength(50));
});

describe("ago", () => {
  it.each([
    [NOW - 10_000, "just now"],
    [NOW - 5 * 60_000, "5 min ago"],
    [NOW - 3 * 3_600_000, "3 h ago"],
    [NOW - 3 * DAY, "3 d ago"],
    [NOW + 5000, "just now"],
  ])("%i is %s", (at, want) => expect(ago(at, NOW)).toBe(want));
});
