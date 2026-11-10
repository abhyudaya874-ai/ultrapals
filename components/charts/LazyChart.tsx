"use client";
import dynamic from "next/dynamic";

/** Recharts is large: it is only fetched when a chart is actually on screen. */
export const ChartView = dynamic(() => import("./ChartView").then((m) => m.ChartView), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-card bg-surface-2" />,
});
