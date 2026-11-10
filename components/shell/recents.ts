export interface Item {
  id: string;
  title: string;
  state: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}
export type SortBy = "newest" | "oldest" | "name" | "amount";
export type GroupBy = "none" | "date" | "state";
export const SORTS: { id: SortBy; label: string }[] = [{ id: "newest", label: "Newest first" }, { id: "oldest", label: "Oldest first" }, { id: "name", label: "Name" }, { id: "amount", label: "Amount" }];
export const GROUPS: { id: GroupBy; label: string }[] = [{ id: "none", label: "None" }, { id: "date", label: "Date" }, { id: "state", label: "State" }];

export interface RecentsPrefs { sort: SortBy; group: GroupBy; pinned: string[]; open: boolean }
export const DEFAULT_PREFS: RecentsPrefs = { sort: "newest", group: "none", pinned: [], open: true };

/** Pure. Reads saved preferences without trusting them. */
export function parsePrefs(raw: string | null): RecentsPrefs {
  try {
    const j = JSON.parse(raw ?? "null") as Partial<RecentsPrefs> | null;
    return {
      sort: SORTS.some((s) => s.id === j?.sort) ? (j!.sort as SortBy) : DEFAULT_PREFS.sort,
      group: GROUPS.some((g) => g.id === j?.group) ? (j!.group as GroupBy) : DEFAULT_PREFS.group,
      pinned: Array.isArray(j?.pinned) ? j!.pinned.filter((x): x is string => typeof x === "string").slice(0, 50) : [],
      open: j?.open !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Pure. Sorted copy. Ties keep the order they came in (stable). */
export function sortItems(items: readonly Item[], by: SortBy): Item[] {
  const t = (i: Item) => Date.parse(i.createdAt) || 0;
  const cmp: Record<SortBy, (a: Item, b: Item) => number> = {
    newest: (a, b) => t(b) - t(a),
    oldest: (a, b) => t(a) - t(b),
    name: (a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }),
    amount: (a, b) => b.amountMinor - a.amountMinor,
  };
  return [...items].sort(cmp[by]);
}

export type DateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";
/** Pure. Calendar-day buckets in UTC, so the same item is in the same group for every viewer. `now` is a parameter. */
export function dateBucket(iso: string, now: number): DateBucket {
  const day = 86_400_000;
  const startOf = (ms: number) => Math.floor(ms / day) * day;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "Earlier";
  const d = startOf(now) - startOf(then);
  return d <= 0 ? "Today" : d === day ? "Yesterday" : d < 7 * day ? "Previous 7 days" : "Earlier";
}

const STATE_LABEL: Record<string, string> = { open: "Waiting", capture_pending: "Capturing", captured: "Paid", declined: "Declined", released: "Released" };
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? s;

export interface Group { label: string; items: Item[] }
/** Pure. Groups in a fixed, meaningful order (dates newest first, states by how much attention they need). Items keep their incoming order inside a group. */
export function groupItems(items: readonly Item[], by: GroupBy, now: number): Group[] {
  if (by === "none") return items.length ? [{ label: "", items: [...items] }] : [];
  const order = by === "date" ? ["Today", "Yesterday", "Previous 7 days", "Earlier"] : ["Waiting", "Capturing", "Paid", "Declined", "Released"];
  const buckets = new Map<string, Item[]>();
  for (const i of items) {
    const k = by === "date" ? dateBucket(i.createdAt, now) : stateLabel(i.state);
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  }
  const known = order.filter((k) => buckets.has(k));
  const other = [...buckets.keys()].filter((k) => !order.includes(k));
  return [...known, ...other].map((label) => ({ label, items: buckets.get(label)! }));
}

/** Pure. Pinned items (in the order they were pinned) and the rest. A pin for an item that no longer exists is ignored. */
export function splitPinned(items: readonly Item[], pinned: readonly string[]): { pinned: Item[]; rest: Item[] } {
  const by = new Map(items.map((i) => [i.id, i]));
  const pins = pinned.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
  const set = new Set(pins.map((p) => p.id));
  return { pinned: pins, rest: items.filter((i) => !set.has(i.id)) };
}

/** Pure. Toggle a pin; the newest pin goes last, and at most 50 are kept. */
export const togglePin = (pinned: readonly string[], id: string): string[] => (pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id].slice(-50));
