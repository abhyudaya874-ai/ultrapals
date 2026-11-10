"use client";
import { useMemo, useState } from "react";
import { ChartView } from "@/components/charts/LazyChart";
import { IconLayers } from "@/components/ui/icons";
import { CHART_TYPES, problems, type ChartSpec } from "@/lib/charts/spec";
import type { ChartItem } from "@/lib/computer/run";
import { useAgent } from "./AgentProvider";
import { chartTab } from "./panel-model";

/** The chart types that can show this spec's columns as they are (so the person can switch without a model call). */
export const fittingTypes = (spec: ChartSpec) => CHART_TYPES.filter((t) => problems({ ...spec, type: t }).length === 0);

/** A chart UltraPal drew: the picture, why that type, and a switcher for the other types that fit the same columns. */
export function ChartBlock({ item, height = 260, inPanel = false }: { item: ChartItem; height?: number; inPanel?: boolean }) {
  const { openTab } = useAgent();
  const [type, setType] = useState(item.spec.type);
  const spec = useMemo(() => ({ ...item.spec, type }), [item.spec, type]);
  const options = useMemo(() => fittingTypes(item.spec), [item.spec]);
  return (
    <figure className="rise rounded-card border border-line bg-surface p-4" data-testid="chart-block">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[14px] font-medium text-fg">{item.spec.title ?? "Chart"}</span>
        {item.source && <span className="truncate text-[12px] text-fg-dim">{item.source.replace(/^artifacts\//, "")}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {options.length > 1 && (
            <select value={type} onChange={(e) => setType(e.target.value as ChartSpec["type"])} aria-label="Chart type" className="h-7 rounded-full border border-line bg-surface-2/70 px-2.5 text-[12px] text-fg-muted outline-none hover:text-fg">
              {[...new Set([item.spec.type, ...options])].map((t) => <option key={t} value={t}>{t.replace("-", " ")}</option>)}
            </select>
          )}
          {!inPanel && <button type="button" onClick={() => openTab(chartTab(item.id))} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-accent hover:bg-surface-2"><IconLayers className="size-3.5" />Open</button>}
        </span>
      </figcaption>
      <ChartView spec={spec} height={height} note={item.note} />
      {item.spec.why && <p className="mt-2 text-[12.5px] text-fg-dim">Why this chart: {item.spec.why}</p>}
    </figure>
  );
}
