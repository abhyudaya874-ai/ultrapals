"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, CandlestickChart, ChartCard, DonutChart, Heatmap, SwimlaneTimeline, WaterfallChart, type Lane } from "@/components/charts/Charts";
import { heat, toCandles } from "@/components/charts/geometry";
import { ProctorPanel } from "@/components/ProctorPanel";
import { activityGrid, amountPoints, moneyFlow, type FlowRow } from "@/lib/charts/flow";
import { DAY, durationPoints, kpis, runGrid, upcomingRuns } from "@/lib/automations/stats";
import type { PublicAutomation } from "@/lib/automations/public";
import { relative } from "@/lib/automations/presets";
import { formatMajor } from "@/lib/money";
import { useAgent } from "./AgentProvider";

interface Article {
  slug: string;
  title: string;
  dek: string;
  premium: boolean;
  price: string;
  published: string;
}
interface VerdictRow extends FlowRow { id: string; title: string; payer: string }
interface ProctorRun { job: string; atMs: number; status: string; note: string }
interface Live { now: number; automations: PublicAutomation[]; verdicts: VerdictRow[]; proctor: ProctorRun[]; loaded: boolean }

const BTN = "h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

/** Automations, verdicts and Proctor runs, refreshed while the artifact is open. A source that fails is empty, never an error screen. */
function useLive(everyMs = 15_000): [Live, () => void] {
  const [s, setS] = useState<Live>({ now: 0, automations: [], verdicts: [], proctor: [], loaded: false });
  const load = useCallback(async () => {
    const get = async <T,>(url: string, pick: (j: unknown) => T, fallback: T): Promise<T> => {
      try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? pick(await r.json()) : fallback; } catch { return fallback; }
    };
    const [a, v, p] = await Promise.all([
      get("/api/automations", (j) => (j as { now: number; automations: PublicAutomation[] }), { now: Date.now(), automations: [] }),
      get("/api/studio/query?limit=200", (j) => (Array.isArray(j) ? (j as VerdictRow[]) : []), [] as VerdictRow[]),
      get("/api/proctor", (j) => ((j as { runs?: ProctorRun[] }).runs ?? []), [] as ProctorRun[]),
    ]);
    setS({ now: a.now, automations: a.automations, verdicts: v, proctor: p, loaded: true });
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return [s, load];
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <p className="text-[11.5px] uppercase tracking-wider text-fg-dim">{label}</p>
      <p className={`mt-1 text-[24px] font-semibold leading-none tabular-nums ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-fg"}`}>{value}</p>
      {sub && <p className="mt-1.5 truncate text-[12px] text-fg-dim">{sub}</p>}
    </div>
  );
}

const Loading = () => <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-card bg-surface-2" />)}</div>;
const NoteLink = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} target="_blank" className="text-accent hover:underline">{children}</Link>;

/** The Newsroom as an artifact. The buttons hand a task to UltraPal; the paywall itself is still unlocked only by PromisePal. */
export function NewsroomArtifact() {
  const { send, busy } = useAgent();
  const [items, setItems] = useState<Article[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/newsroom/articles")
      .then((r) => (r.ok ? r.json() : { articles: [] }))
      .then((d: { articles?: Article[] }) => live && setItems(d.articles ?? []))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, []);
  if (!items) return <div className="m-3 h-40 animate-pulse rounded-card bg-surface-2" />;
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="newsroom-artifact">
      <h2 className="font-serif text-[22px] text-fg">The Newsroom</h2>
      <p className="mt-1 text-[13px] text-fg-muted">Free stories open. Premium ones cost $0.01 and are paid through a Standing Promise only if the article proves readable.</p>
      <ol className="mt-4 space-y-3">
        {items.map((a) => (
          <li key={a.slug} className="rise rounded-card bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-serif text-[17px] leading-snug text-fg">{a.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{a.dek}</p>
              </div>
              <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[11.5px] ${a.premium ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"}`}>{a.premium ? `PREMIUM · $${a.price}` : "FREE"}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={BTN} onClick={() => void send(a.premium ? `Unlock the premium Newsroom story "${a.slug}" with PromisePal, then summarise it in five bullet points.` : `Read the Newsroom story "${a.slug}" and summarise it in five bullet points.`)}>
                {a.premium ? "Unlock and summarise" : "Summarise"}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Dashboard: how the unattended work and the money are doing. Automation reliability and run times, then where promised money went, the mix of
 * outcomes, when verdicts happen and how big the promises are. Everything is drawn from stored runs and verdicts; nothing here is estimated.
 */
export function DashboardArtifact() {
  const [d, reload] = useLive();
  const { send, busy } = useAgent();
  const k = useMemo(() => kpis(d.automations, d.now), [d]);
  const flow = useMemo(() => moneyFlow(d.verdicts), [d.verdicts]);
  const grid = useMemo(() => runGrid(d.automations, d.now || Date.now(), 14), [d]);
  const dur = useMemo(() => toCandles(durationPoints(d.automations), DAY), [d.automations]);
  const amounts = useMemo(() => toCandles(amountPoints(d.verdicts, flow.currency), DAY), [d.verdicts, flow.currency]);
  const activity = useMemo(() => activityGrid(d.verdicts), [d.verdicts]);
  const agentUse = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of d.automations) for (const r of a.runs) for (const role of r.agents) n.set(role, (n.get(role) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [d.automations]);
  if (!d.loaded) return <Loading />;
  const peak = Math.max(1, ...activity.flat());
  const empty = d.automations.length === 0 && d.verdicts.length === 0;
  const states = Object.entries(flow.counts).map(([label, value]) => ({ label: label.replace("_", " "), value }));
  return (
    <div className="h-full space-y-3 overflow-y-auto p-4" data-testid="dashboard-artifact">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-[22px] text-fg">Dashboard</h2>
        <span className="ml-auto flex gap-2">
          <button type="button" className={BTN} onClick={reload}>Refresh</button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void send("Open the dashboard artifact and tell me what stands out: failing automations, money stuck open, anything unusual.")}>Ask UltraPal to read it</button>
        </span>
      </div>
      {empty && <p className="rounded-card border border-dashed border-line p-6 text-center text-[13px] text-fg-dim">Nothing to chart yet. <NoteLink href="/automations">Create an automation</NoteLink> or run a promise, and this fills in.</p>}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Automations" value={`${k.active}/${k.total}`} sub={k.next ? `next: ${k.next.name} ${relative(k.next.at, d.now)}` : "none scheduled"} />
        <Kpi label="Runs, 24 h" value={String(k.runs24h)} sub={`${k.ok24h} ok · ${k.failed24h} failed`} tone={k.failed24h > 0 ? "warn" : undefined} />
        <Kpi label="Success rate" value={k.successRate === null ? "–" : `${Math.round(k.successRate * 100)}%`} sub="last 24 hours" tone={k.successRate === null ? undefined : k.successRate >= 0.9 ? "ok" : k.successRate >= 0.6 ? "warn" : "bad"} />
        <Kpi label={`Captured · ${flow.currency}`} value={formatMajor(flow.captured, flow.currency)} sub={`of ${formatMajor(flow.promised, flow.currency)} promised`} />
      </div>
      <ChartCard title="Automation reliability" note="share of runs that succeeded, last 14 days">
        {d.automations.length === 0 ? <p className="py-6 text-center text-[12.5px] text-fg-dim">No automations yet.</p> : <Heatmap rows={grid.rows} cols={grid.cols.map((c, i) => (i % 2 === 0 ? c : ""))} values={grid.values} cell={30} tip={(r, c, v) => `${grid.rows[r]} · ${grid.cols[c]}: ${v === null ? "no runs" : `${Math.round(v * 100)}% ok of ${grid.counts[r][c]} run${grid.counts[r][c] === 1 ? "" : "s"}`}`} />}
      </ChartCard>
      <ChartCard title="Run time per day" note="seconds: first, slowest, fastest, last run (green = got slower)"><CandlestickChart candles={dur} format={(n) => `${n}s`} height={200} /></ChartCard>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChartCard title="Verdict outcomes" note="latest state of each promise"><DonutChart slices={states} center={{ big: String(Object.values(flow.counts).reduce((a, b) => a + b, 0)), small: "promises" }} /></ChartCard>
        <ChartCard title="Agents used" note="runs per kind of agent"><BarChart bars={agentUse} format={(n) => String(n)} /></ChartCard>
      </div>
      <ChartCard title="Where the promised money went" note={flow.skipped ? `${flow.currency} only; ${flow.skipped} in other currencies left out` : flow.currency}>
        <WaterfallChart steps={[{ label: "Promised", value: flow.promised }, { label: "Released", value: -flow.released }, { label: "Declined", value: -flow.declined }, { label: "Still open", value: -flow.open }, { label: "Captured", value: 0, total: true }]} format={(n) => formatMajor(Math.round(n), flow.currency)} height={200} />
      </ChartCard>
      <ChartCard title="Promise size per day" note={`${flow.currency}: first, highest, lowest, last verdict`}><CandlestickChart candles={amounts} format={(n) => n.toFixed(2)} height={200} /></ChartCard>
      <div>
        <ChartCard title="When verdicts happen" note="UTC weekday × hour">
          <Heatmap rows={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]} cols={Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h) : ""))} cell={22} values={activity.map((row) => row.map((n) => (n === 0 ? null : n / peak)))} tip={(r, c, v) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][r]} ${c}:00 UTC: ${v === null ? 0 : Math.round(v * peak)} verdict${Math.round((v ?? 0) * peak) === 1 ? "" : "s"}`} />
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-dim">fewer <span className="inline-flex gap-0.5">{[0.1, 0.35, 0.6, 0.85, 1].map((t) => <span key={t} className="size-2.5 rounded-sm" style={{ background: heat(t) }} />)}</span> more</p>
        </ChartCard>
      </div>
      <p className="pb-2 text-[12px] text-fg-dim">The classic AG Studio board is still at <NoteLink href="/board">/board</NoteLink>.</p>
    </div>
  );
}

/**
 * Timeline: when things ran and when they will. A lane per automation (finished runs, then planned ones as outlines), one for Proctor's checks
 * and one for promise verdicts. Everything planned is computed from the same schedule the server uses.
 */
export function TimelineArtifact() {
  const [d, reload] = useLive(10_000);
  const { send, busy } = useAgent();
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const [msg, setMsg] = useState("");
  const now = d.now || Date.now();
  const half = (range === "24h" ? 12 : 84) * 3_600_000;
  const from = now - half;
  const to = now + half;

  const lanes = useMemo<Lane[]>(() => {
    const autos = d.automations.map((a): Lane => ({
      label: a.name,
      sub: a.scheduleText,
      items: [
        ...a.runs.map((r) => ({ start: r.atMs, end: r.atMs + r.ms, kind: r.status, title: `${r.status === "ok" ? "Finished" : "Failed"} ${relative(r.atMs, now)} · ${Math.round(r.ms / 1000)}s${r.error ? ` · ${r.error}` : ""}` })),
        ...upcomingRuns({ schedule: a.schedule, tzOffsetMin: a.tzOffsetMin, nextRunMs: a.nextRunMs, enabled: a.enabled }, now, to).map((t) => ({ start: t, kind: "planned" as const, title: `Planned ${relative(t, now)}` })),
      ],
    }));
    const proctor: Lane = { label: "Proctor", sub: "sandbox checks", items: d.proctor.map((r) => ({ start: r.atMs, kind: r.status === "case_opened" || r.status === "changed_unreported" ? "error" : r.status === "flaked" || r.status === "missed" ? "warn" : "ok", title: `${r.status}: ${r.note}` })) };
    const promises: Lane = { label: "Promises", sub: "verdicts", items: d.verdicts.map((v) => ({ start: Date.parse(v.at), kind: "event" as const, title: `${v.title} · ${v.state}` })) };
    return [...autos, proctor, promises];
  }, [d, now, to]);

  const upcoming = useMemo(() => d.automations.flatMap((a) => upcomingRuns({ schedule: a.schedule, tzOffsetMin: a.tzOffsetMin, nextRunMs: a.nextRunMs, enabled: a.enabled }, now, now + 7 * DAY, 3).map((t) => ({ a, t }))).sort((x, y) => x.t - y.t).slice(0, 8), [d, now]);
  if (!d.loaded) return <Loading />;
  const runNow = async (id: string) => {
    setMsg("");
    const r = await fetch("/api/automations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) setMsg(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not start the run.");
    reload();
  };
  return (
    <div className="h-full space-y-3 overflow-y-auto p-4" data-testid="timeline-artifact">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-[22px] text-fg">Timeline</h2>
        <span className="ml-auto flex items-center gap-2">
          <span className="flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Range">
            {(["24h", "7d"] as const).map((r) => <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`h-7 rounded-md px-2.5 text-[12.5px] ${range === r ? "bg-line text-fg" : "text-fg-muted hover:text-fg"}`}>{r === "24h" ? "24 hours" : "7 days"}</button>)}
          </span>
          <button type="button" className={BTN} disabled={busy} onClick={() => void send("Open the timeline artifact and summarise what ran, what failed and what is coming next.")}>Ask UltraPal</button>
        </span>
      </div>
      <ChartCard title="Schedule" note="filled = ran, outline = planned, dots = events" legend={[{ label: "ok", color: "#519b53" }, { label: "failed", color: "#d2646e" }, { label: "warning", color: "#c9a14a" }, { label: "event", color: "#4e99a3" }]}>
        <SwimlaneTimeline lanes={lanes} from={from} to={to} now={now} />
      </ChartCard>
      <section className="rounded-card border border-line bg-surface p-4" aria-label="Up next">
        <h3 className="mb-2 text-[13.5px] font-medium text-fg">Up next</h3>
        {upcoming.length === 0 ? <p className="text-[12.5px] text-fg-dim">Nothing planned. <NoteLink href="/automations">Create an automation</NoteLink> to see it here.</p> : (
          <ul className="divide-y divide-line">
            {upcoming.map(({ a, t }, i) => (
              <li key={`${a.id}-${t}`} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="w-16 shrink-0 tabular-nums text-fg-dim">{relative(t, now)}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
                <span className="hidden shrink-0 text-[12px] text-fg-dim sm:inline">{a.scheduleText}</span>
                {i === upcoming.findIndex((x) => x.a.id === a.id) && <button type="button" className={BTN} disabled={a.running || d.automations.some((x) => x.running)} onClick={() => void runNow(a.id)}>Run now</button>}
              </li>
            ))}
          </ul>
        )}
        {msg && <p role="alert" className="mt-2 text-[12.5px] text-bad">{msg}</p>}
      </section>
      <p className="pb-2 text-[12px] text-fg-dim">The classic Bryntum scheduler is still at <NoteLink href="/timeline">/timeline</NoteLink>.</p>
    </div>
  );
}

export function ProctorArtifact() {
  return (
    <div className="h-full overflow-y-auto p-3" data-testid="proctor-artifact">
      <ProctorPanel />
    </div>
  );
}
