"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/agent/Markdown";
import { ModelPill } from "@/components/agent/ModelPill";
import { useAgent } from "@/components/agent/AgentProvider";
import { displayName } from "@/components/agent/panel-model";
import { ProctorPanel } from "@/components/ProctorPanel";
import { IconBolt, IconChevronDown, IconFile, IconPlay, IconTrash } from "@/components/ui/icons";
import { SiteChip } from "@/components/ui/SiteChip";
import { PRESETS, SUGGESTIONS, buildSchedule, nameFromPrompt, relative, type PresetId } from "@/lib/automations/presets";
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

function Create({ onCreated }: { onCreated: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<PresetId>("daily");
  const [time, setTime] = useState("09:00");
  const [level, setLevel] = useState<Level>("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timed = PRESETS.find((p) => p.id === preset)?.timed ?? false;
  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await api("/api/automations", { method: "POST", body: JSON.stringify({ name: nameFromPrompt(prompt), prompt, schedule: buildSchedule(preset, time), tzOffsetMin: -new Date().getTimezoneOffset(), level, enabled: true }) });
    setBusy(false);
    if (r.ok) { setPrompt(""); onCreated(); } else setErr(r.error);
  };
  return (
    <section aria-label="Create an automation">
      <form onSubmit={(e) => { e.preventDefault(); if (prompt.trim().length >= 3 && !busy) void submit(); }} className="rounded-dock border border-dock-line bg-dock p-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={1500} aria-label="What should run" placeholder="Describe what you want automated: research, run commands, browse, save files…" className="block min-h-[4.5rem] w-full resize-none bg-transparent px-1.5 py-1 text-[15px] text-fg outline-none placeholder:text-fg-dim" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={preset} onChange={(e) => setPreset(e.target.value as PresetId)} aria-label="How often" className="h-9 rounded-full border border-line bg-surface-2/70 px-3 text-[13px] text-fg-muted outline-none hover:text-fg">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {timed && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" className="h-9 rounded-full border border-line bg-surface-2/70 px-3 text-[13px] text-fg-muted outline-none" />}
          <span className="flex-1" />
          <ModelPill value={{ level }} onChange={(c) => setLevel(c.level)} allowCustom={false} />
          <button type="submit" disabled={busy || prompt.trim().length < 3} className="h-9 rounded-full bg-fg px-4 text-[13.5px] font-medium text-canvas hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
      {err && <p role="alert" className="mt-2 px-2 text-[12.5px] text-bad">{err}</p>}
      <div className="mt-5">
        <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Suggested</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {SUGGESTIONS.map((s) => (
            <li key={s.title}>
              <button type="button" onClick={() => { setPrompt(s.prompt); setPreset(s.preset); }} className="h-full w-full rounded-card border border-dashed border-line p-4 text-left transition-colors hover:border-dock-line hover:bg-surface">
                <span className="block text-[14px] font-medium text-fg">{s.title}</span>
                <span className="mt-1 block text-[12.5px] leading-snug text-fg-dim">{s.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Card({ a, now, busyId, reload }: { a: PublicAutomation; now: number; busyId: string | null; reload: () => void }) {
  const { openLocalFile, rememberFiles } = useAgent();
  const router = useRouter();
  const [open, setOpen] = useState(false);
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

  const act = async (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setMsg("");
    const r = await f();
    if (!r.ok) setMsg(r.error);
    reload();
  };
  const status = a.running ? { text: "Running…", dot: "bg-warn animate-pulse" } : !a.enabled ? { text: "Paused", dot: "bg-fg-dim" } : lastRun ? { text: lastRun.status === "ok" ? "Last run ok" : "Last run failed", dot: DOT[lastRun.status] } : { text: "Waiting for its first run", dot: "bg-fg-dim" };
  const shown = detail ?? a;
  return (
    <li className="rounded-card border border-line bg-surface" data-testid="automation">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <IconBolt className="size-5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-medium text-fg">{a.name}</span>
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
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div>
            <h3 className="text-[12px] font-medium uppercase tracking-wide text-fg-dim">Task</h3>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-fg-muted">{a.prompt}</p>
            <p className="mt-1 text-[12px] text-fg-dim">{a.runsToday} of {a.dailyCap} runs used in the last 24 hours. PromisePal is never used in an automation.</p>
          </div>
          {shown.runs.length === 0 && <p className="text-[13px] text-fg-dim">No runs yet. Press Run now to try it.</p>}
          {shown.runs.map((r) => (
            <article key={r.id} className="rounded-lg border border-line bg-canvas/40 p-3" data-testid="automation-run">
              <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-muted"><span className={`size-2 rounded-full ${DOT[r.status]}`} />{r.status === "ok" ? "Finished" : "Failed"} {relative(r.atMs, now)} · {Math.round(r.ms / 1000)}s{r.agents.length > 0 && <> · {r.agents.join(", ")}</>}{r.model && <> · {r.model}</>}</p>
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
      )}
    </li>
  );
}

/** Automations: describe a job and when it should run; the same agent team (research, browser, terminal, rivals) does it unattended and keeps the result. */
export function AutomationsView() {
  const [data, setData] = useState<Listing | null>(null);
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

  return (
    <main className="h-full overflow-y-auto" data-testid="automations-page">
      <div className="mx-auto w-full max-w-[860px] px-6 py-8">
        <header className="mb-6 text-center">
          <h1 className="font-serif text-[32px] leading-tight text-fg">Automate anything with UltraPal</h1>
          <p className="mt-1 text-[14px] text-fg-muted">Run research, browsing and terminal work on a schedule. Results and files are kept here and in Artifacts.</p>
        </header>
        <Create onCreated={() => void load()} />
        {data?.scheduler === "off" && <p className="mt-4 rounded-card border border-line bg-surface p-3 text-[12.5px] text-warn">The built-in timer is off (AUTOMATIONS_SCHEDULER=off). Automations only run when something calls POST /api/automations/tick, or when you press Run now.</p>}

        <h2 className="mb-2 mt-9 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Your automations{data ? ` · ${data.automations.length}` : ""}</h2>
        {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        {!data && !error && <div className="h-20 animate-pulse rounded-card bg-surface-2" />}
        {data && data.automations.length === 0 && <p className="rounded-card border border-dashed border-line p-6 text-center text-[13.5px] text-fg-dim">Nothing scheduled yet. Pick a suggestion above, or ask UltraPal in chat: “check this every morning”.</p>}
        <ul className="space-y-3">{data?.automations.map((a) => <Card key={a.id} a={a} now={data.now} busyId={data.busy} reload={() => void load()} />)}</ul>
        {data && <p className="mt-3 text-[12px] text-fg-dim">Stored on this server in .data/automations.json. A host with a throwaway disk forgets them on redeploy.</p>}

        <h2 className="mb-2 mt-9 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Built in</h2>
        <ProctorPanel />
      </div>
    </main>
  );
}
