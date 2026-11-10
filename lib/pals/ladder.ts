import { ARCHETYPES, type Archetype } from "./rival";

export type Metric =
  | "attacks_missed"
  | "human_steps_at_capture"
  | "buyer_steps"
  | "evidence_fields_missing"
  | "fee_over_budget_minor"
  | "unquoted_fx_claims"
  | "unsigned_agent_actions"
  | "reversal_unverified";

export type Provenance = "analyst" | "published" | "measured";
export type RowStatus = "BAR_MET" | "BAR_MISSED" | "NOT_MEASURABLE" | "NOT_APPLICABLE";

interface Bar {
  metric: Metric;
  value: number;
  provenance: Provenance;
  hard: boolean; // a miss refuses the deal instead of shipping a live condition
  observable: boolean; // a blind spot can be compiled into a runtime WAIT instead of refusing
}

/** Fixed per-archetype pass lines. The model picks which archetypes apply; it never writes a threshold. Every bar is `observed <= value`. */
export const ARCHETYPE_TABLE: Record<Archetype, Bar> = {
  counterparty: { metric: "attacks_missed", value: 0, provenance: "measured", hard: true, observable: true },
  latency: { metric: "human_steps_at_capture", value: 0, provenance: "analyst", hard: false, observable: true },
  friction: { metric: "buyer_steps", value: 2, provenance: "analyst", hard: false, observable: true },
  evidence: { metric: "evidence_fields_missing", value: 0, provenance: "analyst", hard: false, observable: true },
  cost: { metric: "fee_over_budget_minor", value: 0, provenance: "measured", hard: false, observable: true },
  corridor: { metric: "unquoted_fx_claims", value: 0, provenance: "analyst", hard: false, observable: true },
  identity: { metric: "unsigned_agent_actions", value: 0, provenance: "analyst", hard: false, observable: false },
  reversal: { metric: "reversal_unverified", value: 0, provenance: "measured", hard: true, observable: true },
};

/** What the run actually produced, already extracted from the event log. A missing key means "could not see". */
export interface Measurements {
  values: Partial<Record<Metric, number>>;
  attacksRun?: number;
  notApplicable?: Partial<Record<Archetype, string>>; // archetype -> why the bar does not bite on this contract
}

export interface LadderRow {
  archetype: Archetype;
  metric: Metric;
  bar: { op: "<="; value: number; provenance: Provenance };
  observed: number | null;
  status: RowStatus;
  note?: string;
}

/**
 * Pure. One row per requested archetype. A missing or non-integer measurement is NOT_MEASURABLE, which never counts as
 * a pass (same rule as the verdict: "could not see" is never good news). Zero attacks run proves nothing.
 */
export function scoreLadder(m: Measurements, archetypes: readonly Archetype[] = ARCHETYPES): LadderRow[] {
  return archetypes.map((archetype) => {
    const bar = ARCHETYPE_TABLE[archetype];
    const base = { archetype, metric: bar.metric, bar: { op: "<=" as const, value: bar.value, provenance: bar.provenance } };
    const why = m.notApplicable?.[archetype];
    if (why) return { ...base, observed: null, status: "NOT_APPLICABLE", note: why };
    const observed = m.values[bar.metric];
    if (observed === undefined || !Number.isInteger(observed) || observed < 0) return { ...base, observed: null, status: "NOT_MEASURABLE" };
    if (archetype === "counterparty" && (m.attacksRun ?? 0) < 1) return { ...base, observed, status: "NOT_MEASURABLE", note: "no attack was run" };
    return { ...base, observed, status: observed <= bar.value ? "BAR_MET" : "BAR_MISSED" };
  });
}

export function tally(rows: LadderRow[]): Record<RowStatus, number> {
  const t: Record<RowStatus, number> = { BAR_MET: 0, BAR_MISSED: 0, NOT_MEASURABLE: 0, NOT_APPLICABLE: 0 };
  for (const r of rows) t[r.status]++;
  return t;
}
