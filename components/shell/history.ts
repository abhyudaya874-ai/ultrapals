import { formatMajor } from "@/lib/money";
import { KIND_INFO, kindOf } from "@/lib/automations/kinds";
import type { PublicBrief } from "@/lib/automations/public";
import { stateLabel, type Item as PromiseRow } from "./recents";

/**
 * The sidebar's history: chats, battles, loops, automations and promises in one list. Pure. Each source (the browser's saved conversations, the
 * server's automations, the database's promises) is turned into the same row, so filtering, sorting, grouping, pinning and selecting work the same way for all.
 */
export const HKINDS = ["chat", "battle", "loop", "automation", "promise"] as const;
export type HKind = (typeof HKINDS)[number];
export const HKIND_INFO: Record<HKind, { label: string; plural: string }> = {
  chat: { label: "Chat", plural: "Chats" },
  battle: { label: "Battle", plural: "Battles" },
  loop: { label: "Loop", plural: "Loops" },
  automation: { label: "Automation", plural: "Automations" },
  promise: { label: "Promise", plural: "Promises" },
};

/** How the dot beside a row looks: running now, fine, needs attention, failed, or at rest (no dot). */
export type Tone = "live" | "ok" | "warn" | "bad" | "rest";

export interface HItem {
  /** `${source}:${id}` (convo, automation, promise): unique across sources, so a pin or a selection never confuses a chat with a promise. */
  key: string;
  /** What the row is, for its icon and for grouping by type. */
  kind: HKind;
  /** Every kind it counts as for the filter (a chat in which a Battle was run is also a Battle). */
  kinds: HKind[];
  id: string;
  title: string;
  /** When it last changed, in ms. Sorting and date groups use it. */
  at: number;
  tone: Tone;
  /** One short word for grouping by status. */
  status: string;
  /** A second line for the tooltip: schedule, amount, how many messages. */
  hint: string;
  /** Promises only: for sorting by amount. */
  amountMinor?: number;
  /** A promise is an audit log and cannot be deleted; everything else can. */
  deletable: boolean;
  /** Chats, battles and loops can be renamed; the others take their name from what they are. */
  renamable: boolean;
}

const PROMISE_TONE: Record<string, Tone> = { open: "warn", capture_pending: "live", captured: "ok", declined: "bad", released: "rest" };

/** Pure. A promise row from the database. */
export function fromPromise(p: PromiseRow): HItem {
  let amount = "";
  try { amount = `${formatMajor(p.amountMinor, p.currency)} ${p.currency}`; } catch { /* an unknown currency shows no amount rather than a wrong one */ }
  const status = stateLabel(p.state);
  return { key: `promise:${p.id}`, kind: "promise", kinds: ["promise"], id: p.id, title: p.title, at: Date.parse(p.createdAt) || 0, tone: PROMISE_TONE[p.state] ?? "rest", status, hint: [amount, status].filter(Boolean).join(" · "), amountMinor: p.amountMinor, deletable: false, renamable: false };
}

/** What the sidebar needs to know about an automation (the light listing from /api/automations?brief=1). */
export type BriefAutomation = PublicBrief;

/** Pure. An automation row. */
export function fromAutomation(a: BriefAutomation): HItem {
  const status = a.running ? "Running" : !a.enabled ? "Paused" : a.last === "error" ? "Failed" : a.blocked ? "Needs you" : "On";
  const tone: Tone = a.running ? "live" : !a.enabled ? "rest" : a.last === "error" ? "bad" : a.blocked ? "warn" : "ok";
  const kind = kindOf(a.kind); // the list comes over the network: a kind this code does not know is a Team task, not a crash
  const label = KIND_INFO[kind].label;
  return { key: `automation:${a.id}`, kind: "automation", kinds: ["automation"], id: a.id, title: a.name, at: Math.max(a.createdAtMs, a.lastRunMs ?? 0), tone, status, hint: `${label}${a.count ? ` · ${a.count} ${KIND_INFO[kind].count?.label.toLowerCase() ?? ""}` : ""} · ${a.scheduleText}`, deletable: true, renamable: false };
}

/** A conversation saved in this browser. */
export interface ConvoMeta {
  id: string;
  title: string;
  /** Every kind of run it holds, first one first. */
  kinds: ("chat" | "battle" | "loop")[];
  createdAt: number;
  updatedAt: number;
  /** How many messages (runs) it holds. */
  runs: number;
  status: "running" | "waiting" | "error" | "done";
}

/** Pure. A conversation row. The first kind of run it holds is what it is shown as. */
export function fromConvo(c: ConvoMeta): HItem {
  const kind = c.kinds[0] ?? "chat";
  const status = c.status === "running" ? "Running" : c.status === "waiting" ? "Needs you" : c.status === "error" ? "Failed" : "Done";
  const tone: Tone = c.status === "running" ? "live" : c.status === "waiting" ? "warn" : c.status === "error" ? "bad" : "rest";
  return { key: `convo:${c.id}`, kind, kinds: c.kinds.length ? c.kinds : ["chat"], id: c.id, title: c.title, at: c.updatedAt, tone, status, hint: `${c.runs} ${c.runs === 1 ? "message" : "messages"}`, deletable: true, renamable: true };
}

export type SortBy = "newest" | "oldest" | "name" | "amount";
export type GroupBy = "none" | "date" | "type" | "status";
export const SORTS: { id: SortBy; label: string }[] = [{ id: "newest", label: "Newest first" }, { id: "oldest", label: "Oldest first" }, { id: "name", label: "Name" }, { id: "amount", label: "Amount (promises)" }];
export const GROUPS: { id: GroupBy; label: string }[] = [{ id: "none", label: "None" }, { id: "date", label: "Date" }, { id: "type", label: "Type" }, { id: "status", label: "Status" }];

export interface HistoryPrefs {
  sort: SortBy;
  group: GroupBy;
  /** The kinds shown; empty means all. */
  kinds: HKind[];
  /** Pinned rows, by key, in the order they were pinned. */
  pinned: string[];
  open: boolean;
}
export const DEFAULT_PREFS: HistoryPrefs = { sort: "newest", group: "none", kinds: [], pinned: [], open: true };

/** Pure. Reads saved preferences without trusting them. A list saved by the promises-only sidebar still works: its pins were bare promise ids, and it grouped by "state". */
export function parsePrefs(raw: string | null): HistoryPrefs {
  try {
    const j = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    const group = j?.group === "state" ? "status" : j?.group;
    return {
      sort: SORTS.some((s) => s.id === j?.sort) ? (j!.sort as SortBy) : DEFAULT_PREFS.sort,
      group: GROUPS.some((g) => g.id === group) ? (group as GroupBy) : DEFAULT_PREFS.group,
      kinds: Array.isArray(j?.kinds) ? [...new Set((j!.kinds as unknown[]).filter((k): k is HKind => (HKINDS as readonly unknown[]).includes(k)))] : [],
      pinned: Array.isArray(j?.pinned) ? [...new Set((j!.pinned as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 80).map((x) => (x.includes(":") ? x : `promise:${x}`)))].slice(0, 50) : [],
      open: j?.open !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Pure. The rows of the kinds chosen (all when none is chosen) whose title contains the text. */
export function filterItems(items: readonly HItem[], kinds: readonly HKind[], query = ""): HItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => (kinds.length === 0 || kinds.some((k) => i.kinds.includes(k))) && (!q || i.title.toLowerCase().includes(q)));
}

/** Pure. A kind added to the filter, or taken out when it is already there. */
export const toggleKind = (kinds: readonly HKind[], k: HKind): HKind[] => (kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);

/** Pure. How many rows each kind has (a conversation counts for every kind it holds). */
export function countsByKind(items: readonly HItem[]): Record<HKind, number> {
  const out: Record<HKind, number> = { chat: 0, battle: 0, loop: 0, automation: 0, promise: 0 };
  for (const i of items) for (const k of new Set(i.kinds)) out[k]++;
  return out;
}

/** Pure. Sorted copy. Ties keep the order they came in. Rows without an amount go last when sorting by amount. */
export function sortItems(items: readonly HItem[], by: SortBy): HItem[] {
  const cmp: Record<SortBy, (a: HItem, b: HItem) => number> = {
    newest: (a, b) => b.at - a.at,
    oldest: (a, b) => a.at - b.at,
    name: (a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }),
    amount: (a, b) => (b.amountMinor ?? -1) - (a.amountMinor ?? -1) || b.at - a.at,
  };
  return [...items].sort(cmp[by]);
}

export type DateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";
/** Pure. Calendar-day buckets in UTC, so the same row is in the same group for every viewer. `now` is a parameter. */
export function dateBucket(at: number, now: number): DateBucket {
  const day = 86_400_000;
  const startOf = (ms: number) => Math.floor(ms / day) * day;
  if (!Number.isFinite(at) || at <= 0) return "Earlier";
  const d = startOf(now) - startOf(at);
  return d <= 0 ? "Today" : d === day ? "Yesterday" : d < 7 * day ? "Previous 7 days" : "Earlier";
}

const STATUS_ORDER = ["Running", "Needs you", "Failed", "Waiting", "Capturing", "On", "Paused", "Done", "Paid", "Released", "Declined"];
export interface Group { label: string; items: HItem[] }
/** Pure. Groups in a fixed, meaningful order (dates newest first, types as listed, statuses by how much attention they need). Rows keep their incoming order inside a group. */
export function groupItems(items: readonly HItem[], by: GroupBy, now: number): Group[] {
  if (by === "none") return items.length ? [{ label: "", items: [...items] }] : [];
  const order = by === "date" ? ["Today", "Yesterday", "Previous 7 days", "Earlier"] : by === "type" ? HKINDS.map((k) => HKIND_INFO[k].plural) : STATUS_ORDER;
  const buckets = new Map<string, HItem[]>();
  for (const i of items) {
    const k = by === "date" ? dateBucket(i.at, now) : by === "type" ? HKIND_INFO[i.kind].plural : i.status;
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  }
  const known = order.filter((k) => buckets.has(k));
  const other = [...buckets.keys()].filter((k) => !order.includes(k));
  return [...known, ...other].map((label) => ({ label, items: buckets.get(label)! }));
}

/** Pure. Pinned rows (in the order they were pinned) and the rest. A pin for a row that no longer exists is ignored. */
export function splitPinned(items: readonly HItem[], pinned: readonly string[]): { pinned: HItem[]; rest: HItem[] } {
  const by = new Map(items.map((i) => [i.key, i]));
  const pins = pinned.flatMap((k) => (by.has(k) ? [by.get(k)!] : []));
  const set = new Set(pins.map((p) => p.key));
  return { pinned: pins, rest: items.filter((i) => !set.has(i.key)) };
}

/** Pure. Toggle a pin; the newest pin goes last, and at most 50 are kept. */
export const togglePin = (pinned: readonly string[], key: string): string[] => (pinned.includes(key) ? pinned.filter((p) => p !== key) : [...pinned, key].slice(-50));

/** Pure. A row added to the selection, or taken out when it is already there. */
export const toggleKey = (sel: readonly string[], key: string): string[] => (sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]);

/** Pure. What a bulk action would do to the selected rows that are still in the list: which can be deleted and which cannot (a promise is an audit log). */
export function bulkPlan(items: readonly HItem[], selected: readonly string[]): { chosen: HItem[]; deletable: HItem[]; kept: HItem[]; allPinned: (pinned: readonly string[]) => boolean } {
  const set = new Set(selected);
  const chosen = items.filter((i) => set.has(i.key));
  return { chosen, deletable: chosen.filter((i) => i.deletable), kept: chosen.filter((i) => !i.deletable), allPinned: (pinned) => chosen.length > 0 && chosen.every((i) => pinned.includes(i.key)) };
}

/** Pure. Pins every chosen row, or unpins them all when each one is already pinned. */
export function pinBulk(pinned: readonly string[], chosen: readonly HItem[]): string[] {
  const keys = chosen.map((c) => c.key);
  return keys.length > 0 && keys.every((k) => pinned.includes(k)) ? pinned.filter((p) => !keys.includes(p)) : [...pinned.filter((p) => !keys.includes(p)), ...keys].slice(-50);
}

/** Pure. "2 min ago", "3 h ago", "5 d ago". `now` is a parameter. */
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}
