import { ARCHETYPE_TABLE, type LadderRow } from "./ladder";
import type { Archetype } from "./rival";

export type Seal = "SEALED" | "CONDITIONAL" | "REFUSED";

export interface SealDecision {
  seal: Seal;
  reason: string;
  liveConditions: Archetype[]; // axes the run could not close: compiled into runtime WAITs, printed on the receipt
}

export const MAX_LIVE_CONDITIONS = 3;

/**
 * SealPal. Pure. Every EXAMINED axis closed -> SEALED (axes nobody examined are listed as excluded, never counted). An open axis that can still be watched at runtime -> CONDITIONAL.
 * An open hard axis, or an open axis nobody can observe, or too much dissent, or nothing measured at all -> REFUSED.
 * This may change a program before sealing; it never produces or alters a verdict.
 */
export function decideSeal(rows: LadderRow[]): SealDecision {
  const live = rows.filter((r) => r.status !== "NOT_APPLICABLE");
  if (live.length === 0) return { seal: "REFUSED", reason: "nothing was measured", liveConditions: [] };

  const open = live.filter((r) => r.status !== "BAR_MET");
  const hard = open.find((r) => ARCHETYPE_TABLE[r.archetype].hard);
  if (hard) return { seal: "REFUSED", reason: `hard axis open: ${hard.archetype}`, liveConditions: [] };
  const blind = open.find((r) => r.status === "NOT_MEASURABLE" && !ARCHETYPE_TABLE[r.archetype].observable);
  if (blind) return { seal: "REFUSED", reason: `unobservable axis open: ${blind.archetype}`, liveConditions: [] };

  if (open.length === 0) return { seal: "SEALED", reason: `every examined axis closed (${live.length})`, liveConditions: [] };
  const liveConditions = open.map((r) => r.archetype);
  if (liveConditions.length > MAX_LIVE_CONDITIONS) return { seal: "REFUSED", reason: `${liveConditions.length} open axes is more dissent than a program can carry`, liveConditions: [] };
  return { seal: "CONDITIONAL", reason: `open but observable: ${liveConditions.join(", ")}`, liveConditions };
}
