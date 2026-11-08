"use client";
import "@bryntum/scheduler/scheduler.css"; // base structure
import "@bryntum/scheduler/svalbard-dark.css"; // theme
import "@bryntum/scheduler/fontawesome/css/fontawesome.css"; // icons need both fontawesome files
import "@bryntum/scheduler/fontawesome/css/solid.css";
import { BryntumScheduler } from "@bryntum/scheduler-react";
import { useEffect, useMemo, useState } from "react";
import { toScheduler, type TimelineRow } from "@/lib/integrations/bryntum";

interface ApiRow {
  id: string; promiseId: string; payer: string; title: string; amountMinor: number; currency: string; state: TimelineRow["state"]; at: string;
}

/** Client-only (Bryntum touches `window`): load it with next/dynamic { ssr: false }. */
export default function PromiseTimeline() {
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  useEffect(() => {
    fetch("/api/studio/query?limit=200").then((r) => r.json()).then((d: ApiRow[]) => setRows(d)).catch(() => setRows([]));
  }, []);

  const data = useMemo(() => toScheduler((rows ?? []).map((r) => ({ id: r.id, promiseId: r.promiseId, payer: r.payer, title: r.title, dueAtIso: r.at, state: r.state, amountMinor: r.amountMinor, currency: r.currency }))), [rows]);
  if (!rows) return <div className="h-full animate-pulse rounded-card bg-surface-2" />;
  if (data.events.length === 0) return <p className="p-4 text-[13px] text-fg-dim">No promises yet.</p>;

  return (
    <BryntumScheduler
      resources={data.resources}
      events={data.events}
      viewPreset="dayAndWeek"
      eventStyle="filled"
      onAfterEventDrop={({ eventRecords }) => {
        // A drag rewrites the due date and nothing else. The server refuses anything that is not OPEN.
        const rec = eventRecords[0];
        if (!rec) return;
        const pid = String((rec as { promiseId?: string }).promiseId ?? rec.id);
        void fetch("/api/promise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "reschedule", promiseId: pid, windowEndsAt: new Date(rec.endDate).toISOString() }),
        });
      }}
    />
  );
}
