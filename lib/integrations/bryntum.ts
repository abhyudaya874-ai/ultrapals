import type { PromiseState } from "@/db/schema";
import { formatMajor } from "@/lib/money";

export type TimelineCls = "met" | "unmet" | "pending";

export interface TimelineRow {
  id: string; // unique per verdict row: Bryntum rejects duplicate event ids when a promise was settled more than once
  promiseId: string;
  payer: string;
  title: string;
  dueAtIso: string;
  state: PromiseState;
  amountMinor: number;
  currency: string;
}

export interface SchedulerData {
  resources: { id: string; name: string }[];
  events: { id: string; promiseId: string; resourceId: string; name: string; startDate: string; endDate: string; cls: TimelineCls }[];
}

const CLS: Record<PromiseState, TimelineCls> = {
  open: "pending",
  capture_pending: "pending",
  captured: "met",
  released: "unmet",
  declined: "unmet",
};

/**
 * Pure. Bryntum Scheduler wants resources + events. Resources = payers, events = promises ending at their due date.
 * A drag only ever rewrites the due date (op "reschedule"). Amounts go through formatMajor, never toFixed.
 */
export function toScheduler(rows: TimelineRow[]): SchedulerData {
  const resources = [...new Set(rows.map((r) => r.payer))].map((p) => ({ id: p, name: p }));
  const events = rows.map((r) => {
    const due = new Date(r.dueAtIso).getTime();
    return {
      id: r.id,
      promiseId: r.promiseId,
      resourceId: r.payer,
      name: `${r.title} · ${formatMajor(r.amountMinor, r.currency)} ${r.currency}`,
      startDate: new Date(due - 3_600_000).toISOString(),
      endDate: new Date(due).toISOString(),
      cls: CLS[r.state],
    };
  });
  return { resources, events };
}
