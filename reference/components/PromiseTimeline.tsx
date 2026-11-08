"use client";
import "@bryntum/scheduler/scheduler.css"; // base structure
import "@bryntum/scheduler/svalbard-light.css"; // theme: VERIFY the filename in node_modules/@bryntum/scheduler/*.css
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
  if (!rows) return <p className="p-4 text-neutral-500">Loading…</p>;
  if (data.events.length === 0) return <p className="p-4 text-neutral-500">No promises yet.</p>;

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
        void fetch("/api/promise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "reschedule", promiseId: String((rec as { promiseId?: string }).promiseId ?? rec.id), windowEndsAt: new Date(rec.endDate).toISOString() }),
        });
      }}
    />
  );
}
