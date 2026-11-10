import { Fragment } from "react";
import { arcPath, compact, donutArcs, heat, niceTicks, pointsAttr, radarShape, scale, timeTicks, waterfall, type Candle } from "./geometry";

/** Series colours: readable on the dark theme and distinguishable without relying on red versus green alone. */
export const SERIES = ["#4e99a3", "#c9a14a", "#d2646e", "#8f7fe0", "#519b53", "#6fb5e8"] as const;
const AXIS = "#6f7277";
const GRID = "#282b2f";
const TEXT = "#979aa0";
const UP = "#519b53";
const DOWN = "#d2646e";

export function ChartCard({ title, note, children, legend }: { title: string; note?: string; children: React.ReactNode; legend?: { label: string; color: string }[] }) {
  return (
    <figure className="rounded-card border border-line bg-surface p-4" data-testid="chart">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13.5px] font-medium text-fg">{title}</span>
        {note && <span className="text-[12px] text-fg-dim">{note}</span>}
        {legend && (
          <span className="ml-auto flex flex-wrap gap-x-3 gap-y-1">
            {legend.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted"><span className="size-2 rounded-full" style={{ background: l.color }} />{l.label}</span>)}
          </span>
        )}
      </figcaption>
      {children}
    </figure>
  );
}

const Empty = ({ text }: { text: string }) => <p className="grid h-32 place-items-center text-[12.5px] text-fg-dim">{text}</p>;

/** Radar: one polygon per series over a shared set of axes, values 0..1. */
export function RadarChart({ axes, series, size = 280 }: { axes: string[]; series: { name: string; values: number[] }[]; size?: number }) {
  if (axes.length < 3 || series.length === 0) return <Empty text="A radar needs at least three axes." />;
  const c = size / 2;
  const r = size / 2 - 46;
  const rings = [0.25, 0.5, 0.75, 1];
  const ends = radarShape(axes.map(() => 1), c, c, r).axes;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[340px]" role="img" aria-label={`Radar chart of ${series.map((s) => s.name).join(", ")}`}>
      {rings.map((k) => <polygon key={k} points={pointsAttr(radarShape(axes.map(() => k), c, c, r).points)} fill="none" stroke={GRID} strokeWidth={1} />)}
      {ends.map((p, i) => <line key={i} x1={c} y1={c} x2={p.x} y2={p.y} stroke={GRID} strokeWidth={1} />)}
      {series.map((s, si) => {
        const col = SERIES[si % SERIES.length];
        const pts = radarShape(axes.map((_, i) => s.values[i] ?? 0), c, c, r).points;
        return (
          <g key={s.name} className="transition-opacity hover:opacity-100" opacity={0.95}>
            <polygon points={pointsAttr(pts)} fill={col} fillOpacity={0.16} stroke={col} strokeWidth={1.75} strokeLinejoin="round"><title>{s.name}</title></polygon>
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={col}><title>{`${s.name} · ${axes[i]}: ${Math.round((s.values[i] ?? 0) * 100)}%`}</title></circle>)}
          </g>
        );
      })}
      {axes.map((a, i) => {
        const lx = c + (r + 16) * Math.sin((i / axes.length) * Math.PI * 2);
        const ly = c - (r + 16) * Math.cos((i / axes.length) * Math.PI * 2);
        const anchor = Math.abs(lx - c) < 4 ? "middle" : lx > c ? "start" : "end";
        return <text key={a} x={lx} y={ly + 3.5} textAnchor={anchor} fontSize={10.5} fill={TEXT}>{a.length > 16 ? `${a.slice(0, 15)}…` : a}</text>;
      })}
    </svg>
  );
}

/** Candlesticks: a body from open to close (green when it rose, red when it fell) and a wick from low to high. */
export function CandlestickChart({ candles, format = compact, label = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), height = 220 }: { candles: Candle[]; format?: (n: number) => string; label?: (t: number) => string; height?: number }) {
  if (candles.length === 0) return <Empty text="No data yet." />;
  const W = 560;
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const t = niceTicks(Math.min(...candles.map((c) => c.low)), Math.max(...candles.map((c) => c.high)), 4);
  const y = scale(t.min, t.max, height - pad.b, pad.t);
  const slot = (W - pad.l - pad.r) / candles.length;
  const bw = Math.max(3, Math.min(22, slot * 0.6));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Candlestick chart">
      {t.ticks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>{format(v)}</text></g>)}
      {candles.map((c, i) => {
        const x = pad.l + slot * i + slot / 2;
        const up = c.close >= c.open;
        const col = up ? UP : DOWN;
        const top = y(Math.max(c.open, c.close));
        const h = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
        const showLabel = candles.length <= 12 || i % Math.ceil(candles.length / 10) === 0;
        return (
          <g key={c.t} className="transition-opacity hover:opacity-80">
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1.5} />
            <rect x={x - bw / 2} y={top} width={bw} height={h} rx={1.5} fill={up ? col : "none"} stroke={col} strokeWidth={1.5} />
            {showLabel && <text x={x} y={height - 7} textAnchor="middle" fontSize={10} fill={AXIS}>{label(c.t)}</text>}
            <title>{`${label(c.t)}\nopen ${format(c.open)} · close ${format(c.close)}\nhigh ${format(c.high)} · low ${format(c.low)} · ${c.n} event${c.n === 1 ? "" : "s"}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/** Waterfall: each bar floats from where the last one ended; a total bar shows where it all adds up. */
export function WaterfallChart({ steps, format = compact, height = 220 }: { steps: { label: string; value: number; total?: boolean }[]; format?: (n: number) => string; height?: number }) {
  const bars = waterfall(steps);
  if (bars.length === 0) return <Empty text="No data yet." />;
  const W = 560;
  const pad = { l: 44, r: 10, t: 14, b: 38 };
  const t = niceTicks(Math.min(0, ...bars.map((b) => Math.min(b.from, b.to))), Math.max(...bars.map((b) => Math.max(b.from, b.to))), 4);
  const y = scale(t.min, t.max, height - pad.b, pad.t);
  const slot = (W - pad.l - pad.r) / bars.length;
  const bw = Math.min(46, slot * 0.62);
  const col = { start: SERIES[0], total: SERIES[0], up: UP, down: DOWN } as const;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Waterfall chart">
      {t.ticks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>{format(v)}</text></g>)}
      {bars.map((b, i) => {
        const x = pad.l + slot * i + (slot - bw) / 2;
        const top = y(Math.max(b.from, b.to));
        const h = Math.max(1.5, Math.abs(y(b.from) - y(b.to)));
        const next = bars[i + 1];
        return (
          <g key={`${b.label}-${i}`} className="transition-opacity hover:opacity-80">
            <rect x={x} y={top} width={bw} height={h} rx={2} fill={col[b.kind]} fillOpacity={b.kind === "total" ? 1 : 0.85} />
            {next && <line x1={x + bw} x2={x + slot} y1={y(b.to)} y2={y(b.to)} stroke={AXIS} strokeDasharray="3 3" strokeWidth={1} />}
            <text x={x + bw / 2} y={top - 4} textAnchor="middle" fontSize={10} fill={TEXT}>{b.kind === "total" || b.kind === "start" ? format(b.to) : `${b.to >= b.from ? "+" : "−"}${format(Math.abs(b.to - b.from))}`}</text>
            <text x={x + bw / 2} y={height - 22} textAnchor="middle" fontSize={10} fill={AXIS}>{b.label.length > 11 ? `${b.label.slice(0, 10)}…` : b.label}</text>
            <title>{`${b.label}: ${b.kind === "total" ? format(b.to) : format(b.to - b.from)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/** Heatmap: rows by columns, one coloured cell per value (0..1, null = no data), with the value as a tooltip. */
export function Heatmap({ rows, cols, values, tip, cell = 26 }: { rows: string[]; cols: string[]; values: (number | null)[][]; tip?: (r: number, c: number, v: number | null) => string; cell?: number }) {
  if (rows.length === 0 || cols.length === 0) return <Empty text="No data yet." />;
  const lw = Math.min(150, Math.max(60, Math.max(...rows.map((r) => r.length)) * 6.2));
  const W = lw + cols.length * cell + 8;
  const H = 18 + rows.length * cell + 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H * 1.8 }} role="img" aria-label="Heatmap">
      {cols.map((c, j) => <text key={`c${j}`} x={lw + j * cell + cell / 2} y={11} textAnchor="middle" fontSize={9.5} fill={AXIS}>{c}</text>)}
      {rows.map((r, i) => (
        <Fragment key={`r${i}`}>
          <text x={lw - 8} y={18 + i * cell + cell / 2 + 3.5} textAnchor="end" fontSize={10.5} fill={TEXT}>{r.length > 22 ? `${r.slice(0, 21)}…` : r}</text>
          {cols.map((_, j) => {
            const v = values[i]?.[j] ?? null;
            return (
              <rect key={j} x={lw + j * cell + 1.5} y={18 + i * cell + 1.5} width={cell - 3} height={cell - 3} rx={4} fill={heat(v)} className="transition-opacity hover:opacity-70">
                <title>{tip ? tip(i, j, v) : `${r} · ${cols[j]}: ${v === null ? "no data" : `${Math.round(v * 100)}%`}`}</title>
              </rect>
            );
          })}
        </Fragment>
      ))}
    </svg>
  );
}

/** Donut: shares of a whole, with a number or word in the middle. */
export function DonutChart({ slices, center, size = 168 }: { slices: { label: string; value: number; color?: string }[]; center?: { big: string; small?: string }; size?: number }) {
  const arcs = donutArcs(slices.map((s) => s.value));
  if (arcs.every((a) => a.share === 0)) return <Empty text="No data yet." />;
  const c = size / 2;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-[168px] shrink-0" role="img" aria-label="Donut chart">
        {arcs.map((a, i) => a.share > 0 && <path key={slices[i].label} d={arcPath(c, c, c * 0.62, c - 3, a.a0, a.a1)} fill={slices[i].color ?? SERIES[i % SERIES.length]} className="transition-opacity hover:opacity-80"><title>{`${slices[i].label}: ${slices[i].value} (${Math.round(a.share * 100)}%)`}</title></path>)}
        {center && <><text x={c} y={c + 2} textAnchor="middle" fontSize={22} fontWeight={600} fill="#dbdee3">{center.big}</text>{center.small && <text x={c} y={c + 18} textAnchor="middle" fontSize={10.5} fill={AXIS}>{center.small}</text>}</>}
      </svg>
      <ul className="space-y-1">
        {slices.map((s, i) => <li key={s.label} className="flex items-center gap-2 text-[12.5px] text-fg-muted"><span className="size-2.5 rounded-sm" style={{ background: s.color ?? SERIES[i % SERIES.length] }} />{s.label}<span className="ml-auto pl-4 tabular-nums text-fg-dim">{s.value}</span></li>)}
      </ul>
    </div>
  );
}

/** Horizontal bars, longest first as given. */
export function BarChart({ bars, format = compact }: { bars: { label: string; value: number; color?: string }[]; format?: (n: number) => string }) {
  if (bars.length === 0) return <Empty text="No data yet." />;
  const max = Math.max(...bars.map((b) => b.value), 1e-9);
  return (
    <ul className="space-y-1.5" aria-label="Bar chart">
      {bars.map((b, i) => (
        <li key={b.label} className="grid grid-cols-[minmax(4rem,9rem)_1fr_auto] items-center gap-2 text-[12.5px]">
          <span className="truncate text-fg-muted" title={b.label}>{b.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, (b.value / max) * 100)}%`, background: b.color ?? SERIES[i % SERIES.length] }} /></span>
          <span className="tabular-nums text-fg-dim">{format(b.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Box plot: for each group a box from the first to the third quartile, a line at the median, and whiskers to the min and max. */
export function BoxPlot({ groups, format = compact, height = 220 }: { groups: { label: string; min: number; q1: number; median: number; q3: number; max: number }[]; format?: (n: number) => string; height?: number }) {
  if (groups.length === 0) return <Empty text="No data yet." />;
  const W = 560;
  const pad = { l: 44, r: 10, t: 10, b: 26 };
  const t = niceTicks(Math.min(...groups.map((g) => g.min)), Math.max(...groups.map((g) => g.max)), 4);
  const y = scale(t.min, t.max, height - pad.b, pad.t);
  const slot = (W - pad.l - pad.r) / groups.length;
  const bw = Math.min(46, slot * 0.5);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Box plot">
      {t.ticks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>{format(v)}</text></g>)}
      {groups.map((g, i) => {
        const x = pad.l + slot * i + slot / 2;
        const col = SERIES[i % SERIES.length];
        return (
          <g key={`${g.label}-${i}`} className="transition-opacity hover:opacity-80">
            <line x1={x} x2={x} y1={y(g.max)} y2={y(g.min)} stroke={col} strokeWidth={1.5} />
            <line x1={x - bw / 4} x2={x + bw / 4} y1={y(g.max)} y2={y(g.max)} stroke={col} strokeWidth={1.5} />
            <line x1={x - bw / 4} x2={x + bw / 4} y1={y(g.min)} y2={y(g.min)} stroke={col} strokeWidth={1.5} />
            <rect x={x - bw / 2} y={y(g.q3)} width={bw} height={Math.max(1.5, y(g.q1) - y(g.q3))} rx={3} fill={col} fillOpacity={0.22} stroke={col} strokeWidth={1.5} />
            <line x1={x - bw / 2} x2={x + bw / 2} y1={y(g.median)} y2={y(g.median)} stroke="#dbdee3" strokeWidth={2} />
            <text x={x} y={height - 8} textAnchor="middle" fontSize={10} fill={AXIS}>{g.label.length > 12 ? `${g.label.slice(0, 11)}…` : g.label}</text>
            <title>{`${g.label}\nmin ${format(g.min)} · q1 ${format(g.q1)} · median ${format(g.median)}\nq3 ${format(g.q3)} · max ${format(g.max)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export interface LaneItem { start: number; end?: number; kind: "ok" | "error" | "planned" | "event" | "warn"; title: string }
export interface Lane { label: string; sub?: string; items: LaneItem[] }
const KIND_FILL = { ok: UP, error: DOWN, warn: "#c9a14a", event: SERIES[0], planned: "none" } as const;

/** Swimlanes over time: each lane is a row of runs (green/red), planned runs (dashed outline) and events (dots), with a line at "now". */
export function SwimlaneTimeline({ lanes, from, to, now }: { lanes: Lane[]; from: number; to: number; now: number }) {
  if (lanes.length === 0) return <Empty text="Nothing scheduled yet." />;
  const lw = 132;
  const rowH = 34;
  const W = 640;
  const H = 24 + lanes.length * rowH + 4;
  const x = scale(from, to, lw, W - 10);
  const ticks = timeTicks(from, to);
  const span = to - from;
  const fmt = (t: number) => (span > 3 * 86_400_000 ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Schedule timeline">
      {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={16} y2={H - 4} stroke={GRID} /><text x={x(t)} y={11} textAnchor="middle" fontSize={9.5} fill={AXIS}>{fmt(t)}</text></g>)}
      {lanes.map((l, i) => {
        const y = 22 + i * rowH;
        return (
          <g key={`${l.label}-${i}`}>
            {i % 2 === 0 && <rect x={0} y={y} width={W} height={rowH} fill="rgba(255,255,255,0.025)" />}
            <text x={8} y={y + rowH / 2 - (l.sub ? 1 : -3.5)} fontSize={11.5} fill="#dbdee3">{l.label.length > 18 ? `${l.label.slice(0, 17)}…` : l.label}</text>
            {l.sub && <text x={8} y={y + rowH / 2 + 11} fontSize={9.5} fill={AXIS}>{l.sub.length > 22 ? `${l.sub.slice(0, 21)}…` : l.sub}</text>}
            {l.items.filter((it) => it.start >= from && it.start <= to).map((it, k) => {
              const a = x(it.start);
              if (it.kind === "event") return <circle key={k} cx={a} cy={y + rowH / 2} r={4} fill={KIND_FILL.event} className="transition-opacity hover:opacity-70"><title>{it.title}</title></circle>;
              const w = Math.max(8, it.end ? x(Math.min(it.end, to)) - a : 8);
              return <rect key={k} x={a - 4} y={y + 8} width={w} height={rowH - 16} rx={4} fill={KIND_FILL[it.kind]} fillOpacity={it.kind === "planned" ? 0 : 0.9} stroke={it.kind === "planned" ? SERIES[0] : "none"} strokeDasharray={it.kind === "planned" ? "3 2" : undefined} strokeWidth={1.25} className="transition-opacity hover:opacity-70"><title>{it.title}</title></rect>;
            })}
          </g>
        );
      })}
      {now >= from && now <= to && <g><line x1={x(now)} x2={x(now)} y1={16} y2={H - 4} stroke="#4e99a3" strokeWidth={1.5} /><text x={x(now)} y={H - 0} textAnchor="middle" fontSize={9} fill="#4e99a3">now</text></g>}
    </svg>
  );
}
