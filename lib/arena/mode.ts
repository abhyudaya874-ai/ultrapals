import { MAX_SLOTS, MIN_SLOTS, PLAN_MODES, type PlanMode } from "./plan";

/** What the input box is set to: a normal chat, an UltraPals Battle, or an UltraPals Loop. */
export const MODE_KINDS = ["chat", "battle", "loop"] as const;
export type ModeKind = (typeof MODE_KINDS)[number];
export interface ArenaMode {
  kind: ModeKind;
  /** Battle: how many teams. Loop: the most rounds it may run. */
  n: number;
  plan: PlanMode;
}
export const DEFAULT_MODE: ArenaMode = { kind: "chat", n: 4, plan: "auto" };
export const COUNTS = Array.from({ length: MAX_SLOTS - MIN_SLOTS + 1 }, (_, i) => MIN_SLOTS + i);

export const MODE_INFO: Record<ModeKind, { title: string; blurb: string; unit: string }> = {
  chat: { title: "Chat", blurb: "One UltraPal answers", unit: "" },
  battle: { title: "Battle", blurb: "Teams argue opposite predictions, then a knockout picks the best-supported one", unit: "teams" },
  loop: { title: "Loop", blurb: "One team per round on a new scenario, until the answer stops improving", unit: "rounds" },
};

/** Pure. How many a new Battle or Loop starts with. */
export const defaultCount = (kind: ModeKind): number => (kind === "loop" ? 5 : 4);

/** Pure. Reads a saved or posted mode without trusting it: anything wrong falls back to the default for that field. */
export function parseMode(raw: unknown): ArenaMode {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = (MODE_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as ModeKind) : "chat";
  const n = typeof o.n === "number" && Number.isFinite(o.n) ? Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, Math.round(o.n))) : defaultCount(kind);
  const plan = (PLAN_MODES as readonly unknown[]).includes(o.plan) ? (o.plan as PlanMode) : "auto";
  return { kind, n, plan };
}

/** Pure. What a count means in words, for the menu: a Battle of 4 is semi-finals and a final; a Loop of 5 may stop early. */
export function countHint(kind: ModeKind, n: number): string {
  if (kind === "loop") return n === 2 ? "the base case, then one test" : `up to ${n} rounds, stops early once it stops improving`;
  if (kind !== "battle") return "";
  if (n === 2) return "a head-to-head final";
  if (n === 3) return "one bye, a semi-final and a final";
  if (n === 4) return "semi-finals, a third-place match and a final";
  return `quarter-finals with ${8 - n} bye${8 - n === 1 ? "" : "s"}, then the rest of the bracket`;
}
