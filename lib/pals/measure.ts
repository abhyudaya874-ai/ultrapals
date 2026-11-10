import type { Archetype } from "./rival";
import type { Metric } from "./ladder";

/** What PromisePal actually did in one real run. Every field is something the run observed, never estimated. */
export interface PromiseRunLog {
  promiseId: string;
  approved: boolean; // the buyer consented on PayPal (a human or scripted-on-screen step)
  settled: boolean; // the settle op ran
  state: string; // captured | released | wait | ...
  orderStatusAfter: string | null; // read-back of the PayPal order AFTER settle (null = could not read)
  moneyOpsCarriedId: boolean; // every money step carried the promise id (the mandate ref)
  currency: string;
}

export interface RunMeasurements {
  values: Partial<Record<Metric, number>>;
  notApplicable: Partial<Record<Archetype, string>>;
  from: Metric[]; // which values came from the real run (the panel labels them)
}

/**
 * Pure. Turns a real PromisePal run into exam measurements. Consent is not capture: the buyer approves, but the
 * settle captures with nobody present, so human_steps_at_capture is 0. A release is only "verified" when the
 * order read-back after settle shows the money did NOT move.
 */
export function measureRun(log: PromiseRunLog | null): RunMeasurements {
  if (!log) return { values: {}, notApplicable: {}, from: [] };
  const values: Partial<Record<Metric, number>> = {};
  const notApplicable: Partial<Record<Archetype, string>> = {};
  const from: Metric[] = [];

  values.unsigned_agent_actions = log.moneyOpsCarriedId ? 0 : 1;
  from.push("unsigned_agent_actions");
  if (log.settled) {
    values.human_steps_at_capture = 0; // settle is machine: the human consented earlier, at approval
    from.push("human_steps_at_capture");
  }
  if (log.state === "released") {
    values.reversal_unverified = log.orderStatusAfter !== null && log.orderStatusAfter !== "COMPLETED" ? 0 : 1;
    from.push("reversal_unverified");
  } else {
    notApplicable.reversal = log.state === "captured" ? "run captured; refund route not exercised" : `run ended ${log.state}; nothing to reverse`;
  }
  values.evidence_fields_missing = log.promiseId && log.state && log.orderStatusAfter !== undefined ? 0 : 1;
  from.push("evidence_fields_missing");
  if (log.currency) notApplicable.corridor = `single-currency deal (${log.currency})`;
  return { values, notApplicable, from };
}
