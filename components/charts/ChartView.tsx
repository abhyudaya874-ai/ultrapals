"use client";
import {
  Area, AreaChart, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Funnel, FunnelChart, LabelList, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart, Radar, RadarChart as RRadarChart, ResponsiveContainer, Scatter, ScatterChart, SunburstChart,
  Tooltip, Treemap, XAxis, YAxis, ZAxis,
} from "recharts";
import { boxGroups, candleRows, heatGrid, needsRightAxis, pyramidRows, scatterPoints, seriesRows, slices, tree, waterfallSteps } from "@/lib/charts/prepare";
import { resolveSpec, type ChartSpec } from "@/lib/charts/spec";
import { BoxPlot, CandlestickChart, Heatmap, SERIES, WaterfallChart } from "./Charts";
import { compact } from "./geometry";

const AXIS = { stroke: "#6f7277", fontSize: 11 };
const GRID = "#282b2f";
const TIP = {
  contentStyle: { background: "#1b1d21", border: "1px solid #282b2f", borderRadius: 10, fontSize: 12, color: "#dbdee3" },
  labelStyle: { color: "#979aa0" },
  itemStyle: { color: "#dbdee3" },
  cursor: { fill: "rgba(255,255,255,0.04)", stroke: "#3a3f45" },
} as const;
const fmt = (v: unknown): string => (typeof v === "number" ? compact(v) : String(v ?? ""));
const legend = <Legend wrapperStyle={{ fontSize: 12, color: "#979aa0" }} iconType="circle" iconSize={8} />;
const color = (i: number) => SERIES[i % SERIES.length];

/** Treemap cell: a rounded rectangle with its name and value when there is room. */
function TreeCell(p: { x?: number; y?: number; width?: number; height?: number; index?: number; name?: string; value?: number; depth?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = "", value = 0 } = p;
  if (width < 4 || height < 4) return null;
  return (
    <g>
      <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} rx={6} fill={color(index)} fillOpacity={0.78} stroke="#15171b" strokeWidth={1} />
      {width > 64 && height > 34 && (
        <>
          <text x={x + 8} y={y + 18} fontSize={12} fill="#fff" fontWeight={600}>{name.length > Math.floor(width / 7.5) ? `${name.slice(0, Math.max(1, Math.floor(width / 7.5) - 1))}…` : name}</text>
          <text x={x + 8} y={y + 33} fontSize={11} fill="rgba(255,255,255,0.8)">{compact(value)}</text>
        </>
      )}
    </g>
  );
}

function Body({ spec, height }: { spec: ChartSpec; height: number }) {
  const t = spec.type;
  const ys = spec.y;
  const rows = ["line", "area", "stacked-area", "percent-area", "bar", "stacked-bar", "horizontal-bar", "composed", "radar"].includes(t) ? seriesRows(spec) : [];

  if (t === "candlestick") { const c = candleRows(spec); return <CandlestickChart candles={c.candles} label={(i) => c.names[i] ?? ""} height={height} />; }
  if (t === "waterfall") return <WaterfallChart steps={waterfallSteps(spec)} height={height} />;
  if (t === "heatmap") { const g = heatGrid(spec); return <Heatmap rows={g.rows} cols={g.cols} values={g.values} tip={(r, c) => `${g.rows[r]} · ${g.cols[c]}: ${g.raw[r][c] === null ? "no data" : compact(g.raw[r][c]!)}`} />; }
  if (t === "boxplot") return <BoxPlot groups={boxGroups(spec)} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      {(() => {
        switch (t) {
          case "line":
            return (
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="x" {...AXIS} tickLine={false} minTickGap={24} />
                <YAxis {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
                <Tooltip {...TIP} formatter={fmt} />
                {ys.length > 1 && legend}
                {ys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={color(i)} strokeWidth={2} dot={rows.length <= 30} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive animationDuration={600} />)}
                {rows.length > 60 && <Brush dataKey="x" height={20} stroke="#3a3f45" fill="#1b1d21" travellerWidth={8} />}
              </LineChart>
            );
          case "area": case "stacked-area": case "percent-area":
            return (
              <AreaChart data={rows} stackOffset={t === "percent-area" ? "expand" : undefined} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>{ys.map((k, i) => <linearGradient key={k} id={`g-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color(i)} stopOpacity={0.55} /><stop offset="100%" stopColor={color(i)} stopOpacity={0.04} /></linearGradient>)}</defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="x" {...AXIS} tickLine={false} minTickGap={24} />
                <YAxis {...AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={t === "percent-area" ? (v: number) => `${Math.round(v * 100)}%` : fmt} />
                <Tooltip {...TIP} formatter={fmt} />
                {ys.length > 1 && legend}
                {ys.map((k, i) => <Area key={k} type="monotone" dataKey={k} stroke={color(i)} strokeWidth={2} fill={`url(#g-${i})`} stackId={t === "area" ? undefined : "s"} connectNulls={false} animationDuration={600} />)}
                {rows.length > 60 && <Brush dataKey="x" height={20} stroke="#3a3f45" fill="#1b1d21" travellerWidth={8} />}
              </AreaChart>
            );
          case "bar": case "stacked-bar":
            return (
              <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="x" {...AXIS} tickLine={false} interval={rows.length > 14 ? "preserveStartEnd" : 0} />
                <YAxis {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
                <Tooltip {...TIP} formatter={fmt} />
                {ys.length > 1 && legend}
                {ys.map((k, i) => <Bar key={k} dataKey={k} fill={color(i)} stackId={t === "stacked-bar" ? "s" : undefined} radius={t === "stacked-bar" ? 0 : [4, 4, 0, 0]} animationDuration={600} />)}
                {rows.length > 40 && <Brush dataKey="x" height={20} stroke="#3a3f45" fill="#1b1d21" travellerWidth={8} />}
              </BarChart>
            );
          case "horizontal-bar":
            return (
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} />
                <YAxis type="category" dataKey="x" {...AXIS} tickLine={false} width={96} interval={0} />
                <Tooltip {...TIP} formatter={fmt} />
                {ys.length > 1 && legend}
                {ys.map((k, i) => <Bar key={k} dataKey={k} fill={color(i)} radius={[0, 4, 4, 0]} animationDuration={600} />)}
              </BarChart>
            );
          case "composed": {
            const right = needsRightAxis(spec);
            return (
              <ComposedChart data={rows} margin={{ top: 8, right: right ? 4 : 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="x" {...AXIS} tickLine={false} />
                <YAxis yAxisId="l" {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
                {right && <YAxis yAxisId="r" orientation="right" {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />}
                <Tooltip {...TIP} formatter={fmt} />
                {legend}
                {ys.map((k, i) => i === 0
                  ? <Bar key={k} yAxisId="l" dataKey={k} fill={color(0)} fillOpacity={0.85} radius={[4, 4, 0, 0]} animationDuration={600} />
                  : <Line key={k} yAxisId={right ? "r" : "l"} type="monotone" dataKey={k} stroke={color(i)} strokeWidth={2} dot={rows.length <= 30} animationDuration={600} />)}
              </ComposedChart>
            );
          }
          case "scatter": case "bubble": {
            const pts = scatterPoints(spec);
            return (
              <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis type="number" dataKey="x" name={spec.x} {...AXIS} tickLine={false} tickFormatter={fmt} />
                <YAxis type="number" dataKey="y" name={ys[0]} {...AXIS} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
                {t === "bubble" && <ZAxis type="number" dataKey="z" range={[60, 420]} name={spec.size} />}
                <Tooltip {...TIP} cursor={{ strokeDasharray: "3 3", stroke: "#3a3f45" }} formatter={fmt} />
                <Scatter data={pts} fill={color(0)} fillOpacity={0.7} animationDuration={600}>{pts.map((_, i) => <Cell key={i} fill={color(i)} />)}</Scatter>
              </ScatterChart>
            );
          }
          case "pie": case "donut": {
            const sl = slices(spec);
            return (
              <PieChart>
                <Tooltip {...TIP} formatter={fmt} />
                {legend}
                <Pie data={sl} dataKey="value" nameKey="name" innerRadius={t === "donut" ? "58%" : 0} outerRadius="82%" paddingAngle={sl.length > 1 ? 2 : 0} cornerRadius={t === "donut" ? 4 : 0} stroke="#15171b" label={(p: { percent?: number }) => ((p.percent ?? 0) >= 0.06 ? `${Math.round((p.percent ?? 0) * 100)}%` : "")} labelLine={false} animationDuration={600}>
                  {sl.map((_, i) => <Cell key={i} fill={color(i)} />)}
                </Pie>
              </PieChart>
            );
          }
          case "radar":
            return (
              <RRadarChart data={rows} outerRadius="72%">
                <PolarGrid stroke={GRID} />
                <PolarAngleAxis dataKey="x" tick={{ fill: "#979aa0", fontSize: 11 }} />
                <PolarRadiusAxis {...AXIS} axisLine={false} tick={{ fill: "#6f7277", fontSize: 10 }} tickFormatter={fmt} />
                <Tooltip {...TIP} formatter={fmt} />
                {ys.length > 1 && legend}
                {ys.map((k, i) => <Radar key={k} dataKey={k} name={k} stroke={color(i)} fill={color(i)} fillOpacity={0.2} strokeWidth={2} animationDuration={600} />)}
              </RRadarChart>
            );
          case "radial-bar": {
            const sl = slices(spec).map((s, i) => ({ ...s, fill: color(i) }));
            return (
              <RadialBarChart data={sl} innerRadius="18%" outerRadius="100%" barSize={14}>
                <RadialBar dataKey="value" background={{ fill: "#212327" }} cornerRadius={7} animationDuration={600} />
                <Tooltip {...TIP} formatter={fmt} />
                <Legend iconType="circle" iconSize={8} layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: 12, color: "#979aa0" }} />
              </RadialBarChart>
            );
          }
          case "funnel": {
            const sl = slices(spec).map((s, i) => ({ ...s, fill: color(i) }));
            return (
              <FunnelChart>
                <Tooltip {...TIP} formatter={fmt} />
                <Funnel dataKey="value" nameKey="name" data={sl} isAnimationActive animationDuration={600}>
                  <LabelList position="right" fill="#979aa0" stroke="none" dataKey="name" fontSize={12} />
                </Funnel>
              </FunnelChart>
            );
          }
          case "treemap":
            return (
              <Treemap data={tree(spec)} dataKey="value" nameKey="name" aspectRatio={4 / 3} content={<TreeCell />} isAnimationActive animationDuration={500}>
                <Tooltip {...TIP} formatter={fmt} />
              </Treemap>
            );
          case "sunburst":
            return (
              <SunburstChart data={{ name: "root", children: tree(spec) }} dataKey="value" fill="#4e99a3" stroke="#15171b" textOptions={{ fill: "#fff", fontSize: 11 }}>
                <Tooltip {...TIP} formatter={fmt} />
              </SunburstChart>
            );
          case "pyramid": {
            const pr = pyramidRows(spec);
            const max = Math.max(1, ...pr.map((r) => Math.max(-r.left, r.right)));
            return (
              <BarChart data={pr} layout="vertical" stackOffset="sign" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={3}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" domain={[-max, max]} {...AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(Math.abs(v))} />
                <YAxis type="category" dataKey="x" {...AXIS} tickLine={false} width={64} interval={0} reversed />
                <Tooltip {...TIP} formatter={(v: unknown) => fmt(typeof v === "number" ? Math.abs(v) : v)} />
                {legend}
                <Bar dataKey="left" name={ys[0]} stackId="p" fill={color(0)} radius={[4, 0, 0, 4]} animationDuration={600} />
                <Bar dataKey="right" name={ys[1]} stackId="p" fill={color(1)} radius={[0, 4, 4, 0]} animationDuration={600} />
              </BarChart>
            );
          }
          default:
            return <div />;
        }
      })()}
    </ResponsiveContainer>
  );
}

/** Draws a chart spec. The spec is resolved first, so a type that does not fit its data is replaced by one that does, with a visible note. */
export function ChartView({ spec, height = 260, note }: { spec: ChartSpec; height?: number; note?: string }) {
  const r = resolveSpec(spec);
  const tall = r.spec.type === "treemap" || r.spec.type === "sunburst" || r.spec.type === "radar" || r.spec.type === "radial-bar" || r.spec.type === "pie" || r.spec.type === "donut" ? Math.max(height, 300) : height;
  return (
    <div data-testid="chart-view" data-chart-type={r.spec.type}>
      <Body spec={r.spec} height={tall} />
      {(note || r.note) && <p className="mt-2 text-[12px] text-warn">{r.note ?? note}</p>}
    </div>
  );
}
