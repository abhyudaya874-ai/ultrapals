"use client";
import { AgStudioAiModule } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useEffect, useMemo, useState } from "react";
import { widgets } from "./registry";
import { buildAi } from "./agent";
import { chatAdapter } from "./chat-adapter";

// The chat panel only appears when the AI is switched on in the browser env (the proxy also needs the server-side key).
const AI_ON = process.env.NEXT_PUBLIC_STUDIO_AI === "1";
const MODEL = process.env.NEXT_PUBLIC_STUDIO_MODEL ?? "claude-haiku-4-5";

// Pre-wired demo layout: pill + scoreboard + still-to-come on top, verdicts grid + reason chart below.
// Field refs are "sourceId.fieldKey"; categories take "last", the chart measure takes "sum".
const f = (id: string, aggregation?: "sum" | "avg" | "min" | "max" | "count" | "countd" | "first" | "last") =>
  aggregation ? { id, aggregation } : { id };
const initialState = {
  pages: [
    {
      id: "page1",
      widgets: {
        w1: { type: "verdictPill", dataMapping: { reason: [f("verdicts.reason", "last")] } },
        w2: { type: "scoreboard", dataMapping: { payer: [f("verdicts.payer", "last")], kind: [f("verdicts.kind", "last")] } },
        w3: {
          type: "stillToCome",
          dataMapping: {
            customer: [f("paypal.customer", "last")],
            amountMinor: [f("paypal.amountMinor", "last")],
            currency: [f("paypal.currency", "last")],
            status: [f("paypal.status", "last")],
            dueAt: [f("paypal.dueAt", "last")],
          },
        },
        w4: {
          type: "grid",
          dataMapping: {
            cols: [f("verdicts.title"), f("verdicts.payer"), f("verdicts.state"), f("verdicts.reason"), f("verdicts.consequence"), f("verdicts.amount")],
          },
        },
        w5: { type: "column-chart-grouped", dataMapping: { categoryKey: [f("verdicts.reason")], valueKey: [f("verdicts.amountMinor", "sum")] } },
      },
      widgetLayout: {
        w1: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 6 },
        w2: { xTrack: 6, yTrack: 0, xSpan: 8, ySpan: 8 },
        w3: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 8 },
        w4: { xTrack: 0, yTrack: 8, xSpan: 14, ySpan: 14 },
        w5: { xTrack: 14, yTrack: 8, xSpan: 10, ySpan: 14 },
      },
    },
  ],
  selectedPageId: "page1",
};

export function StudioBoard() {
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [ppal, setPpal] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/studio/query?limit=200")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`query ${r.status}`))))
      .then((d: unknown[]) => live && setRows(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "failed"));
    // PayPal activity is a bonus source: any failure degrades to an empty array, never an error state.
    fetch("/api/studio/paypal")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: unknown) => live && setPpal(Array.isArray(d) ? d : []))
      .catch(() => live && setPpal([]));
    return () => {
      live = false;
    };
  }, []);

  const ai = useMemo(() => (AI_ON ? buildAi(chatAdapter({ endpoint: "/api/studio/llm", model: MODEL })) : undefined), []);
  const data = useMemo(() => ({ sources: [{ id: "verdicts", data: rows ?? [] }, { id: "paypal", data: ppal ?? [] }] }), [rows, ppal]);

  if (error) return <p className="p-4 text-[13px] text-bad">Could not load verdicts: {error}</p>;
  // Mount only when both sources have answered: an empty paypal array at mount leaves w3's fields
  // invalid until the late data lands. The endpoint degrades to [] quickly, so this rarely waits.
  if (!rows || ppal === null) return <div className="h-full animate-pulse rounded-card bg-surface-2" />;
  return (
    <AgStudioProvider licenseKey={process.env.NEXT_PUBLIC_AG_STUDIO_KEY ?? ""} modules={[AgStudioAiModule]}>
      {/* AG Studio ships no dark theme (createStudioTheme() takes no params): paper frame per UI spec, tracked in BACKLOG. */}
      <div className="h-full overflow-auto rounded-2xl bg-white p-2">
        <div className="h-full w-full">
          <AgStudio data={data} widgets={widgets} mode="edit" ai={ai} initialState={initialState} />
        </div>
      </div>
    </AgStudioProvider>
  );
}
