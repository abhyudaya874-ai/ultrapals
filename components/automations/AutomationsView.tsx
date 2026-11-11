"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/agent/Markdown";
import { ModelPill } from "@/components/agent/ModelPill";
import { useAgent } from "@/components/agent/AgentProvider";
import { displayName } from "@/components/agent/panel-model";
import { ProctorPanel } from "@/components/ProctorPanel";
import { UltraOrb } from "@/components/orbs/Orbs";
import { Collapse } from "@/components/ui/Collapse";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { IconAgent, IconArrowDown, IconBattle, IconBolt, IconChevronDown, IconClock, IconDollar, IconFile, IconGlobe, IconLayers, IconLoop, IconPlay, IconSearch, IconTrash } from "@/components/ui/icons";
import { SiteChip } from "@/components/ui/SiteChip";
import { PalStack } from "./PalStack";
import { IDEAS, KINDS, KIND_INFO, MAX_HEAVY_ON, kindOf, type Kind } from "@/lib/automations/kinds";
import { buildSchedule, nameFromPrompt, presetsFor, relative, PRESETS, type PresetId } from "@/lib/automations/presets";
import type { PublicAutomation } from "@/lib/automations/public";
import type { Level } from "@/lib/computer/models";

interface Listing { now: number; busy: string | null; scheduler: "on" | "off"; automations: PublicAutomation[] }

const BTN = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
const DOT = { ok: "bg-ok", error: "bg-bad" } as const;

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    return r.ok ? { ok: true, data: j } : { ok: false, error: j.error ?? `Request failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

const KIND_ICON: Record<Kind, React.ReactNode> = {
  task: <IconAgent className="size-4" />,
  research: <IconSearch className="size-4" />,
  browser: <IconGlobe className="size-4" />,
  watch: <IconClock className="size-4" />,
  rails: <IconDollar className="size-4" />,
  exam: <IconLayers className="size-4" />,
  battle: <IconBattle className="size-4" />,
  loop: <IconLoop className="size-4" />,
};

/** The kinds as a dropdown, the same control Chat, Battle and Loop use in the input box. */
function KindMenu({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  const items: MenuItem<Kind>[] = KINDS.map((k) => ({ value: k, label: KIND_INFO[k].label, hint: KIND_INFO[k].blurb, icon: KIND_ICON[k] }));
  return (
    <Menu label="Kind of automation" value={value} items={items} up={false} testId="kind-menu" width="w-[27rem]" onChange={onChange}>
      <span className="text-accent">{KIND_ICON[value]}</span>
      <span>{KIND_INFO[value].label}</span>
      <IconChevronDown className="size-3.5 opacity-70" />
    </Menu>
  );
}

function Create({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<Kind>("task");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<PresetId>("daily");
  const [time, setTime] = useState("09:00");
  const [level, setLevel] = useState<Level>("standard");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const info = KIND_INFO[kind];
  const presets = presetsFor(kind);
  const timed = PRESETS.find((p) => p.id === preset)?.timed ?? false;
  const needsAddress = (kind === "browser" || kind === "watch") && prompt.trim().length > 0 && !/https?:\/\//i.test(prompt);
  const pick = (k: Kind) => {
    setKind(k);
    setErr("");
    setCount(KIND_INFO[k].count?.default ?? null);
    if (!presetsFor(k).some((p) => p.id === preset)) setPreset(IDEAS[k][0].preset);
  };
  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await api("/api/automations", { method: "POST", body: JSON.stringify({ name: nameFromPrompt(prompt), prompt, schedule: buildSchedule(preset, time), tzOffsetMin: -new Date().getTimezoneOffset(), level, enabled: true, kind, ...(count !== null ? { count } : {}) }) });
    setBusy(false);
    if (r.ok) { setPrompt(""); onCreated(); window.dispatchEvent(new Event("automations:changed")); } else setErr(r.error);
  };
  return (
    <div aria-label="Create an automation" role="group">
      <header className="mb-5 text-center">
        <h1 className="font-serif text-[34px] leading-tight text-fg sm:text-[40px]">
          Automate anything with UltraPal
          <UltraOrb size={60} state={busy ? "working" : "idle"} level={level} className="ml-2 -translate-y-1 align-middle" />
        </h1>
        <p className="mx-auto mt-1 max-w-[640px] text-[14.5px] text-fg-muted">Research, browsing, page watches, payment checks, even Battles and Loops, on a schedule. Results and files are kept here and in Artifacts.</p>
      </header>
      <div className="mb-4 flex flex-col items-center gap-2.5">
        <KindMenu value={kind} onChange={pick} />
        <div className="flex max-w-[640px] items-center justify-center gap-3 px-2 text-left">
          <PalStack kind={kind} level={level} />
          <p className="text-[13.5px] leading-snug text-fg-muted" data-testid="kind-blurb">{info.blurb}</p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (prompt.trim().length >= 3 && !busy) void submit(); }} className="rounded-dock border border-dock-line bg-dock p-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={1500} aria-label="What should run" placeholder={info.placeholder} className="block min-h-[4.5rem] w-full resize-none bg-transparent px-1.5 py-1 text-[15px] text-fg outline-none placeholder:text-fg-dim" />
        {needsAddress && <p className="px-1.5 pt-1 text-[12.5px] text-warn">Include the page address (https://…) so the agent knows where to start.</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={preset} onChange={(e) => setPreset(e.target.value as PresetId)} aria-label="How often" className="h-9 rounded-full border border-line bg-surface-2/70 px-3 text-[13px] text-fg-muted outline-none hover:text-fg">
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {timed && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" className="h-9 rounded-full border border-line bg-surface-2/70 px-3 text-[13px] text-fg-muted outline-none" />}
          {info.count && count !== null && (
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label={info.count.label} className="h-9 rounded-full border border-line bg-surface-2/70 px-3 text-[13px] text-fg-muted outline-none hover:text-fg">
              {Array.from({ length: info.count.max - info.count.min + 1 }, (_, i) => info.count!.min + i).map((n) => <option key={n} value={n}>{n} {info.count!.label.toLowerCase()}</option>)}
            </select>
          )}
          <span className="flex-1" />
          <ModelPill value={{ level }} onChange={(c) => setLevel(c.level)} allowCustom={false} />
          <button type="submit" disabled={busy || prompt.trim().length < 3} className="h-9 rounded-full bg-fg px-4 text-[13.5px] font-medium text-canvas hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
      {info.heavy && <p className="mt-2 px-2 text-[12.5px] text-fg-dim">Each run opens a cloud computer for every {kind === "battle" ? "team" : "round"}, so it repeats at most every 6 hours, runs up to {info.dailyCap} times a day, and only {MAX_HEAVY_ON} Battles or Loops can be on at once.</p>}
      {err && <p role="alert" className="mt-2 px-2 text-[12.5px] text-bad">{err}</p>}
      <div className="mt-5">
        <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Ideas · {info.label}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {IDEAS[kind].map((s) => (
            <li key={s.title}>
              <button type="button" onClick={() => { setPrompt(s.prompt); setPreset(s.preset); if (s.count !== undefined) setCount(s.count); }} className="press h-full w-full rounded-card border border-dashed border-line p-4 text-left transition-colors hover:border-dock-line hover:bg-surface">
                <span className="block text-[14px] font-medium text-fg">{s.title}</span>
                <span className="mt-1 block text-[12.5px] leading-snug text-fg-dim">{s.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Reads `?open=<id>` (the sidebar's link to one automation). Its own component so the page can still be built ahead of time. */
function OpenParam({ onId }: { onId: (id: string | null) => void }) {
  const id = useSearchParams().get("open");
  useEffect(() => onId(id), [id, onId]);
  return null;
}

function Card({ a, now, busyId, reload, forceOpen }: { a: PublicAutomation; now: number; busyId: string | null; reload: () => void; forceOpen: boolean }) {
  const { openLocalFile, rememberFiles, newChat, send } = useAgent();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const [detail, setDetail] = useState<PublicAutomation | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState("");
  const lastRun = a.runs[0];
  const load = useCallback(async () => {
    const r = await api<{ automation: PublicAutomation }>(`/api/automations?id=${a.id}`);
    if (r.ok) {
      setDetail(r.data.automation);
      rememberFiles(r.data.automation.runs.flatMap((run) => run.files.flatMap((f) => (f.content === undefined ? [] : [{ path: f.path, content: f.content, at: run.atMs, source: "automation" as const, from: a.name }]))));
    }
  }, [a.id, a.name, rememberFiles]);
  useEffect(() => { if (open) void load(); }, [open, load, a.lastRunMs]);
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    card.current?.scrollIntoView({ block: "nearest" });
  }, [forceOpen]);

  const act = async (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setMsg("");
    const r = await f();
    if (!r.ok) setMsg(r.error);
    reload();
    window.dispatchEvent(new Event("automations:changed"));
  };
  const status = a.running ? { text: "Running…", dot: "bg-warn animate-pulse" } : !a.enabled ? { text: "Paused", dot: "bg-fg-dim" } : lastRun ? { text: lastRun.status === "ok" ? "Last run ok" : "Last run failed", dot: DOT[lastRun.status] } : { text: "Waiting for its first run", dot: "bg-fg-dim" };
  const shown = detail ?? a;
  const info = KIND_INFO[kindOf(a.kind)];
  // A wall the unattended run could not pass (a CAPTCHA, a sign-in) can be passed with a person there: the same job, as a normal chat run in which the browser stops and asks.
  const withMe = () => { newChat(); void send(a.prompt, { chat: true, browse: a.kind === "browser" || a.kind === "watch" }); router.push("/"); };
  return (
    <li ref={card} className="rounded-card border border-line bg-surface" data-testid="automation">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <IconBolt className="size-5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14.5px] font-medium text-fg">{a.name}</span>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-dim" data-testid="automation-kind">{info.label}{a.count ? ` · ${a.count} ${info.count?.label.toLowerCase() ?? ""}` : ""}</span>
            </span>
            <span className="block truncate text-[12.5px] text-fg-dim">{a.scheduleText} · {a.running ? "running now" : a.enabled && a.nextRunMs ? `next ${relative(a.nextRunMs, now)}` : "paused"}{a.lastRunMs ? ` · last ${relative(a.lastRunMs, now)}` : ""}</span>
          </span>
          <IconChevronDown className={`ml-auto size-4 shrink-0 text-fg-dim transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted"><span className={`size-2 rounded-full ${status.dot}`} />{status.text}</span>
        <span className="flex items-center gap-1.5">
          <button type="button" className={BTN} disabled={a.running || busyId !== null} onClick={() => void act(async () => { const r = await api("/api/automations/run", { method: "POST", body: JSON.stringify({ id: a.id }) }); return r.ok ? { ok: true } : r; })}><IconPlay className="size-3.5" />Run now</button>
          <button type="button" className={BTN} onClick={() => void act(async () => { const r = await api("/api/automations", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: !a.enabled }) }); return r.ok ? { ok: true } : r; })}>{a.enabled ? "Pause" : "Resume"}</button>
          <button type="button" className={`${BTN} ${confirm ? "border-bad text-bad" : ""}`} aria-label={confirm ? "Confirm delete" : "Delete"} onClick={() => { if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); } else void act(async () => { const r = await api(`/api/automations?id=${a.id}`, { method: "DELETE" }); return r.ok ? { ok: true } : r; }); }}><IconTrash className="size-3.5" />{confirm ? "Really delete?" : ""}</button>
        </span>
      </div>
      {msg && <p role="alert" className="px-4 pb-3 text-[12.5px] text-bad">{msg}</p>}
      <Collapse open={open}>
        <div className="space-y-4 border-t border-line p-4">
          <div>
            <h3 className="text-[12px] font-medium uppercase tracking-wide text-fg-dim">{info.label}</h3>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-fg-muted">{a.prompt}</p>
            <p className="mt-1 text-[12px] text-fg-dim">{a.runsToday} of {a.dailyCap} runs used in the last 24 hours. PromisePal is never used in an automation.</p>
          </div>
          {shown.runs.length === 0 && <p className="text-[13px] text-fg-dim">No runs yet. Press Run now to try it.</p>}
          {shown.runs.map((r) => (
            <article key={r.id} className="rounded-lg border border-line bg-canvas/40 p-3" data-testid="automation-run">
              <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-muted"><span className={`size-2 rounded-full ${DOT[r.status]}`} />{r.status === "ok" ? "Finished" : "Failed"} {relative(r.atMs, now)} · {Math.round(r.ms / 1000)}s{r.agents.length > 0 && <> · {r.agents.join(", ")}</>}{r.model && <> · {r.model}</>}</p>
              {r.watch && <p className="mt-1.5"><span className={`rounded-full border px-2 py-0.5 text-[11.5px] ${r.watch === "changed" ? "border-warn/50 text-warn" : "border-line text-fg-dim"}`} data-testid="watch-badge">{r.watch === "changed" ? "Changed since the last run" : r.watch === "unchanged" ? "No change" : "First look (baseline)"}</span></p>}
              {r.blocked && (
                <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-fg-muted" data-testid="blocked-note">
                  <p>A page stopped the browser: {r.blocked.replace(/^Blocked:\s*/, "").replace(/\s*Nobody is available.*$/, "")}</p>
                  <button type="button" className={`${BTN} mt-2`} onClick={withMe}>Run with me watching</button>
                </div>
              )}
              {r.error && <p className="mt-1 text-[12.5px] text-bad">{r.error}</p>}
              {r.answer && <div className="mt-2"><Markdown text={r.answer} /></div>}
              {r.files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {r.files.map((f) => (
                    <li key={f.path}><button type="button" className={BTN} disabled={f.content === undefined} onClick={() => { if (f.content !== undefined) { openLocalFile(f.path, f.content); router.push("/"); } }}><IconFile className="size-3.5" />{displayName(f.path)}</button></li>
                  ))}
                </ul>
              )}
              {r.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.sources.map((s) => <SiteChip key={s.url} url={s.url} title={s.title} />)}</div>}
            </article>
          ))}
        </div>
      </Collapse>
    </li>
  );
}

/** Automations: describe a job and when it should run; the same agent team (research, browser, terminal, rivals) does it unattended and keeps the result. */
export function AutomationsView() {
  const [data, setData] = useState<Listing | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    const r = await api<Listing>("/api/automations");
    if (r.ok) { setData(r.data); setError(""); } else setError(r.error);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const anyRunning = data?.busy != null || data?.automations.some((a) => a.running);
  useEffect(() => {
    timer.current = setTimeout(() => void load(), anyRunning ? 4000 : 20_000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [data, anyRunning, load]);

  const list = useRef<HTMLElement>(null);
  return (
    <main className="h-full overflow-y-auto scroll-smooth" data-testid="automations-page">
      <Suspense fallback={null}><OpenParam onId={setOpenId} /></Suspense>
      {/* The first screen is the form, in the middle of the window like the chat's; the automations you have are just below it. */}
      <section className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center gap-8 px-6 py-10" aria-label="Create">
        <Create onCreated={() => void load()} />
        <button type="button" onClick={() => list.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="press mx-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-fg-dim hover:bg-surface-2 hover:text-fg" data-testid="to-list">
          Your automations{data ? ` · ${data.automations.length}` : ""}<IconArrowDown className="size-3.5" />
        </button>
      </section>
      <section ref={list} className="mx-auto w-full max-w-[860px] scroll-mt-4 px-6 pb-12 pt-4" aria-label="Your automations">
        {data?.scheduler === "off" && <p className="mt-4 rounded-card border border-line bg-surface p-3 text-[12.5px] text-warn">The built-in timer is off (AUTOMATIONS_SCHEDULER=off). Automations only run when something calls POST /api/automations/tick, or when you press Run now.</p>}

        <h2 className="mb-2 mt-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Your automations{data ? ` · ${data.automations.length}` : ""}</h2>
        {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        {!data && !error && <div className="h-20 animate-pulse rounded-card bg-surface-2" />}
        {data && data.automations.length === 0 && <p className="rounded-card border border-dashed border-line p-6 text-center text-[13.5px] text-fg-dim">Nothing scheduled yet. Pick a suggestion above, or ask UltraPal in chat: “check this every morning”.</p>}
        <ul className="space-y-3">{data?.automations.map((a) => <Card key={a.id} a={a} now={data.now} busyId={data.busy} reload={() => void load()} forceOpen={openId === a.id} />)}</ul>
        {data && <p className="mt-3 text-[12px] text-fg-dim">Stored on this server in .data/automations.json. A host with a throwaway disk forgets them on redeploy.</p>}

        <h2 className="mb-2 mt-9 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Built in</h2>
        <ProctorPanel />
      </section>
    </main>
  );
}
