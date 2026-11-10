import { runAttacks, type AttackReport } from "./attacks";
import { scoreLadder, type LadderRow, type Metric } from "./ladder";
import { ARCHETYPES, MUTATIONS, type Archetype, type Rival } from "./rival";
import { decideSeal, type SealDecision } from "./seal";

/** What the caller really observed about the deal. Anything it leaves out is NOT_MEASURABLE, never assumed. */
export interface Observed {
  values?: Partial<Record<Metric, number>>;
  notApplicable?: Partial<Record<Archetype, string>>;
}

export interface ExamResult {
  archetypes: Archetype[];
  rows: LadderRow[];
  seal: SealDecision;
  attacks: AttackReport;
  excluded: { archetype: Archetype; why: string }[];
}

/**
 * Pure. The judge ALWAYS faces the full hostile battery (its robustness does not depend on which rivals the search found), so the
 * counterparty axis is always examined; the other axes only where a cited rival owns them. Excluded axes print with a reason.
 */
export function runExam(rivals: Rival[], observed: Observed = {}): ExamResult {
  const archetypes = [...new Set<Archetype>(["counterparty", ...rivals.map((r) => r.archetype)])];
  const attacks = runAttacks(MUTATIONS);
  const values = { ...observed.values };
  if (attacks.run.length > 0) values.attacks_missed = attacks.run.filter((a) => !a.survived).length;
  else delete values.attacks_missed;
  const rows = scoreLadder({ values, attacksRun: attacks.run.length, notApplicable: observed.notApplicable }, archetypes);
  return {
    archetypes,
    rows,
    seal: decideSeal(rows),
    attacks,
    excluded: ARCHETYPES.filter((a) => !archetypes.includes(a)).map((archetype) => ({ archetype, why: "no cited rival owns this axis for this deal" })),
  };
}
