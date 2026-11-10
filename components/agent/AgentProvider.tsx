"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODE, parseMode, type ArenaMode } from "@/lib/arena/mode";
import { defaultPlan, type Plan } from "@/lib/arena/plan";
import type { Attachment, CEvent } from "@/lib/computer/events";
import { MAX_IMAGES } from "@/lib/computer/images";
import { DEFAULT_CHOICE, parseChoice, type ModelChoice } from "@/lib/computer/models";
import { applyCEvent, newRun, parseCStream, type Run } from "@/lib/computer/run";
import { STORE_KEY, mergeStored, parseStored, type StoredFile } from "./artifact-store";
import { prepareImage, refuseFile, type PendingImage } from "./image-prep";
import { chunkDelay, expandEvent, paceDelay } from "./pace";
import { createPump } from "./pump";
import { NO_PANEL, agentTab, appTab, collectFiles, fileTab, isAppArtifact, moveTab, parseTab, withTab, withoutTab, type PanelState } from "./panel-model";

/** Kept for callers that still say "open the files tab": it opens the newest file, or just the panel. */
export type WorkspaceTab = "browser" | "terminal" | "files" | "sources" | "agent";

/** A picture that was just chosen and is still being shrunk: shown at once, so the box reacts on the frame it was dropped. */
export interface DraftImage { id: string; name: string; url: string }
/** A Battle or Loop waiting for the person to read, edit and approve its scenarios. `plan` is null while a model is drafting it. */
export interface PendingPlan { message: string; kind: "battle" | "loop"; planMode: "ai" | "manual"; plan: Plan | null; drafted: boolean; note: string | null }
export interface StageState { open: boolean; runId: string | null }

interface AgentCtx {
  open: boolean;
  mode: ArenaMode;
  setMode: (m: ArenaMode) => void;
  drafts: DraftImage[];
  pendingPlan: PendingPlan | null;
  approvePlan: (plan: Plan) => void;
  cancelPlan: () => void;
  stage: StageState;
  openStage: (runId?: string) => void;
  closeStage: () => void;
  busy: boolean;
  runs: Run[];
  attachments: Attachment[];
  images: PendingImage[];
  model: ModelChoice;
  /** A short problem to show under the input (an image that could not be attached, a failed send). */
  notice: string | null;
  panel: PanelState;
  /** The floating live-browser player (bottom right). `expanded` is the large view with "Take over". */
  pip: PipState;
  setPip: (p: Partial<PipState>) => void;
  reorderTabs: (id: string, to: number) => void;
  /** Files from other sources (an automation's run) opened as tabs; path -> text. */
  localFiles: Record<string, string>;
  /** Files the agents made, remembered in this browser for the Artifacts page. */
  stored: StoredFile[];
  liveViewUrl: string | null;
  /** The browser agent stopped for the person (a CAPTCHA, a sign-in) and is waiting for them: what to do, and where. Null once they reply. */
  handoff: Run["handoff"] | null;
  /** The conversation's id on the server (the live browser's controls talk to the server with it). Null before the first message. */
  sessionId: string | null;
  /** Puts a freshly opened browser in the corner player. */
  adoptBrowser: (liveViewUrl: string) => void;
  page: { url: string; title: string } | null;
  toggle: (force?: boolean) => void;
  /** `browse: true` means the message is an instruction for the live browser: the browser agent acts on the page that is already open. */
  send: (message: string, opts?: { browse?: boolean }) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  addAttachment: (text: string, path: string) => void;
  removeAttachment: (id: string) => void;
  addImages: (files: File[]) => Promise<void>;
  removeImage: (id: string) => void;
  setModel: (m: ModelChoice) => void;
  clearNotice: () => void;
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  closePanel: () => void;
  openApp: (name: string) => void;
  openLocalFile: (path: string, content: string) => void;
  /** Remember files an automation made so the Artifacts page lists them. */
  rememberFiles: (files: StoredFile[]) => void;
  /** Compatibility for the thread's chips. */
  openWorkspace: (tab: WorkspaceTab, agentId?: string) => void;
  closeWorkspace: () => void;
  focusTick: number; // bumped whenever the dock should grab focus
}

const Ctx = createContext<AgentCtx | null>(null);
export const useAgent = (): AgentCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgent outside AgentProvider");
  return c;
};

export interface PipState {
  open: boolean;
  expanded: boolean;
}
const NO_PIP: PipState = { open: false, expanded: false };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SID = "sp-agent-session";
const MODEL_KEY = "sp-model";
const MODE_KEY = "sp-mode";
const MAX_SELECTION = 4000;

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [model, setModelState] = useState<ModelChoice>(DEFAULT_CHOICE);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setModeState] = useState<ArenaMode>(DEFAULT_MODE);
  const [drafts, setDrafts] = useState<DraftImage[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [stage, setStage] = useState<StageState>({ open: false, runId: null });
  const planTicket = useRef(0);
  const [panel, setPanel] = useState<PanelState>(NO_PANEL);
  const [pip, setPipState] = useState<PipState>(NO_PIP);
  const [localFiles, setLocalFiles] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<StoredFile[]>([]);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [page, setPage] = useState<AgentCtx["page"]>(null);
  const [focusTick, setFocusTick] = useState(0);
  const session = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const savedSig = useRef("");

  useEffect(() => {
    session.current = sessionStorage.getItem(SID);
    setSessionId(session.current);
    try {
      setModelState(parseChoice(JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null")));
      setModeState(parseMode(JSON.parse(localStorage.getItem(MODE_KEY) ?? "null")));
      setStored(parseStored(localStorage.getItem(STORE_KEY)));
    } catch {
      /* private mode or a corrupt value: defaults are fine */
    }
  }, []);

  // Remember the files agents wrote, so the Artifacts page has them after a reload. Only when a file really changed.
  useEffect(() => {
    const files = collectFiles(runs).filter((f) => f.write);
    const sig = files.map((f) => `${f.path}:${f.writes}:${f.content.length}`).join("|");
    if (!files.length || sig === savedSig.current) return;
    savedSig.current = sig;
    const now = Date.now();
    setStored((prev) => {
      const next = mergeStored(prev, files.map((f) => ({ path: f.path, content: f.content, at: now, source: "chat" as const })));
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* quota: the in-memory list still works */ }
      return next;
    });
  }, [runs]);

  const toggle = useCallback((force?: boolean) => {
    setOpen((o) => {
      const next = force ?? !o;
      if (next) setFocusTick((t) => t + 1);
      return next;
    });
  }, []);

  const addAttachment = useCallback((text: string, path: string) => {
    const t = text.trim().slice(0, MAX_SELECTION);
    if (!t) return;
    setAttachments((a) => (a.some((x) => x.text === t) ? a : [...a, { id: crypto.randomUUID(), text: t, path }].slice(-5)));
    setOpen(true);
    setFocusTick((n) => n + 1);
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    let have = images.length + drafts.length;
    const taken: { id: string; file: File; url: string }[] = [];
    for (const f of files) {
      const why = refuseFile(f, have);
      if (why) { setNotice(why); break; }
      have++;
      taken.push({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f) });
    }
    if (!taken.length) return;
    // the thumbnails appear on this frame; shrinking and encoding happen behind them
    setDrafts((d) => [...d, ...taken.map((t) => ({ id: t.id, name: t.file.name || "image", url: t.url }))]);
    await Promise.all(taken.map(async (t) => {
      try {
        const img = await prepareImage(t.file);
        setImages((x) => [...x, { ...img, id: t.id, url: t.url }].slice(0, MAX_IMAGES));
      } catch (e) {
        URL.revokeObjectURL(t.url);
        setNotice(e instanceof Error ? e.message : "That image could not be attached.");
      } finally {
        setDrafts((d) => d.filter((x) => x.id !== t.id));
      }
    }));
  }, [images.length, drafts.length]);

  const setModel = useCallback((m: ModelChoice) => {
    setModelState(m);
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); } catch { /* not remembered; still applies to this tab */ }
  }, []);

  const setMode = useCallback((m: ArenaMode) => {
    const next = parseMode(m);
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  }, []);
  const openStage = useCallback((runId?: string) => setStage((st) => ({ open: true, runId: runId ?? st.runId })), []);
  const closeStage = useCallback(() => setStage((st) => ({ ...st, open: false })), []);

  const adoptBrowser = useCallback((url: string) => {
    setLiveViewUrl(url);
    setPipState((p) => (p.open ? p : { open: true, expanded: false }));
  }, []);

  const setPip = useCallback((p: Partial<PipState>) => setPipState((cur) => ({ ...cur, ...p })), []);
  const reorderTabs = useCallback((id: string, to: number) => setPanel((p) => moveTab(p, id, to)), []);
  const openTab = useCallback((id: string) => setPanel((p) => (parseTab(id) ? withTab(p, id, true) : p)), []);
  const closeTab = useCallback((id: string) => setPanel((p) => withoutTab(p, id)), []);
  const closePanel = useCallback(() => setPanel((p) => ({ ...p, open: false })), []);
  const openApp = useCallback((name: string) => { if (isAppArtifact(name)) setPanel((p) => withTab(p, appTab(name), true)); }, []);
  const openLocalFile = useCallback((path: string, content: string) => {
    setLocalFiles((f) => ({ ...f, [path]: content }));
    setPanel((p) => withTab(p, fileTab(path), true));
  }, []);

  const rememberFiles = useCallback((files: StoredFile[]) => {
    if (!files.length) return;
    setStored((prev) => {
      const next = mergeStored(prev, files);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  /** Starts one run: a normal chat message, or a Battle or Loop (with its approved plan when a person set or edited it). */
  const run = useCallback(async (message: string, m: ArenaMode, approved?: Plan, opts?: { browse?: boolean }) => {
    const contest = m.kind !== "chat";
    const atts = contest ? [] : attachments;
    const pics = contest ? [] : images;
    const text = message.trim() || (pics.length ? "Describe the attached image." : "");
    if (text.length < 2 || running.current) return;
    running.current = true;
    const id = crypto.randomUUID();
    const path = `${location.pathname}${location.search}`;
    if (!contest) {
      setAttachments([]);
      setImages([]);
    }
    setNotice(null);
    setRuns((r) => [...r, newRun(id, text, atts, pics.map((p) => ({ id: p.id, name: p.name, url: p.url })))]);
    setBusy(true);
    const ctl = (abort.current = new AbortController());
    const patch = (f: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? f(r) : r)));
    const fail = (m: string) => patch((r) => applyCEvent(r, { kind: "error", message: m }));
    const post = (sessionId: string | null) =>
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({ sessionId: sessionId ?? undefined, message: text, path, attachments: atts, images: pics.map(({ name, mime, data }) => ({ name, mime, data })), model, ...(contest ? { mode: m, approved } : {}), ...(opts?.browse ? { browse: true } : {}), tz: -new Date().getTimezoneOffset() }),
      });
    try {
      let res = await post(session.current);
      if (res.status === 410) {
        session.current = null;
        sessionStorage.removeItem(SID);
        setSessionId(null);
        setLiveViewUrl(null);
        res = await post(null);
      }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        return fail(j?.error ?? `Request failed (${res.status}).`);
      }
      const sid = res.headers.get("x-session-id");
      if (sid) {
        session.current = sid;
        sessionStorage.setItem(SID, sid);
        setSessionId(sid);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // Events are shown one at a time, paced (pace.ts), so a burst from the server (ten files at the end of a search) streams in instead of dumping.
      let firstFile = true;
      let contest = false; // a Battle or Loop shows its own screen, so its report files do not open tabs by themselves
      const show = (e: CEvent) => {
        if (e.kind === "handoff") setPipState({ open: true, expanded: true }); // the browser is theirs now: show it big, in take-over
        if (e.kind === "arena") { contest = true; setStage({ open: true, runId: id }); }
        else if (e.kind === "workspace") {
          setLiveViewUrl(e.liveViewUrl);
          setPipState((p) => (p.open ? p : { open: true, expanded: false }));
        } else if (e.kind === "page") setPage({ url: e.url, title: e.title });
        else if (e.kind === "term") setPanel((w) => withTab(w, "terminal", false));
        else if (e.kind === "sources" || e.kind === "visit") setPanel((w) => withTab(w, "sources", false));
        else if (e.kind === "open" && isAppArtifact(e.artifact)) setPanel((w) => withTab(w, appTab(e.artifact), true));
        else if (e.kind === "file" && e.mode !== "read" && firstFile && !contest) {
          // only the first file of a run opens a tab by itself; the rest are rows in the thread with an Open button
          firstFile = false;
          setPanel((w) => withTab(w, fileTab(e.path), true));
        }
        patch((r) => applyCEvent(r, e));
      };
      const pump = createPump<{ e: CEvent; split: boolean }>(
        ({ e }) => show(e),
        ({ e, split }, waiting) => (split ? chunkDelay(e, true) : paceDelay(e, waiting)),
        sleep,
      );
      const push = (events: CEvent[]) => {
        for (const e of events) {
          const parts = expandEvent(e);
          pump.push(parts.map((p) => ({ e: p, split: parts.length > 1 })));
        }
      };
      ctl.signal.addEventListener("abort", pump.hurry);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const p = parseCStream((buf += dec.decode(value, { stream: true })));
        buf = p.rest;
        if (p.events.length) push(p.events);
      }
      await pump.idle();
      patch((r) => (r.status === "running" ? applyCEvent(r, { kind: "error", message: "The stream ended early." }) : r));
    } catch (e) {
      fail(ctl.signal.aborted ? "Stopped." : e instanceof Error ? e.message : "Network error.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [attachments, images, model]);

  /** Opens the editor for a Battle or Loop whose scenarios the person approves or writes; a model drafts them first when asked to. */
  const beginPlan = useCallback(async (message: string, m: ArenaMode) => {
    const kind = m.kind === "loop" ? "loop" : "battle";
    const ticket = ++planTicket.current;
    const question = message.trim().slice(0, 300);
    const base: PendingPlan = { message, kind, planMode: m.plan === "manual" ? "manual" : "ai", plan: null, drafted: false, note: null };
    if (m.plan === "manual") {
      setPendingPlan({ ...base, plan: defaultPlan(kind, m.n, { question }), note: "Write each scenario in your own words. These are placeholders." });
      return;
    }
    setPendingPlan(base);
    const standard = (why: string) => setPendingPlan((p) => (p && ticket === planTicket.current ? { ...p, plan: defaultPlan(kind, m.n, { question }), note: `${why} This is the standard line-up. Edit it, then approve.` } : p));
    try {
      const res = await fetch("/api/arena/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, n: m.n, scenario: message, model }) });
      const j = (await res.json().catch(() => null)) as { plan?: Plan; drafted?: boolean; error?: string } | null;
      if (ticket !== planTicket.current) return;
      if (!res.ok || !j?.plan) return standard(j?.error ?? `The draft failed (${res.status}).`);
      const plan = j.plan;
      setPendingPlan((p) => (p ? { ...p, plan, drafted: !!j.drafted, note: j.drafted ? "Drafted by a model. Edit anything, then approve." : "No model could draft this. This is the standard line-up. Edit it, then approve." } : p));
    } catch (e) {
      standard(e instanceof Error ? e.message : "The draft failed.");
    }
  }, [model]);

  const send = useCallback(async (message: string, opts?: { browse?: boolean }) => {
    if (running.current) return;
    if (opts?.browse) return run(message, DEFAULT_MODE, undefined, opts); // an instruction for the live browser is always a normal run
    if (mode.kind !== "chat" && mode.plan !== "auto") {
      if (message.trim().length >= 2) await beginPlan(message, mode);
      return;
    }
    await run(message, mode);
  }, [mode, beginPlan, run]);

  const approvePlan = useCallback((plan: Plan) => {
    const p = pendingPlan;
    if (!p) return;
    setPendingPlan(null);
    void run(p.message, { kind: p.kind, n: plan.slots.length, plan: p.planMode }, plan);
  }, [pendingPlan, run]);
  const cancelPlan = useCallback(() => { planTicket.current++; setPendingPlan(null); }, []);

  const stop = useCallback(() => abort.current?.abort(), []);

  const newChat = useCallback(() => {
    abort.current?.abort();
    const sid = session.current;
    session.current = null;
    sessionStorage.removeItem(SID);
    setSessionId(null);
    if (sid) void fetch(`/api/agent?sessionId=${sid}`, { method: "DELETE" }).catch(() => undefined);
    planTicket.current++;
    setPendingPlan(null);
    setStage({ open: false, runId: null });
    setDrafts([]);
    setRuns([]);
    setAttachments([]);
    setImages([]);
    setNotice(null);
    setLiveViewUrl(null);
    setPage(null);
    setPanel(NO_PANEL);
    setPipState(NO_PIP);
    setLocalFiles({});
  }, []);

  const value = useMemo<AgentCtx>(
    () => ({
      mode, setMode, drafts, pendingPlan, approvePlan, cancelPlan, stage, openStage, closeStage,
      sessionId, adoptBrowser, handoff: runs.at(-1)?.handoff ?? null,
      open, busy, runs, attachments, images, model, notice, panel, pip, setPip, reorderTabs, localFiles, stored, liveViewUrl, page, focusTick,
      toggle, send, stop, newChat, addAttachment, addImages, setModel, openTab, closeTab, closePanel, openApp, openLocalFile, rememberFiles,
      removeAttachment: (id) => setAttachments((a) => a.filter((x) => x.id !== id)),
      removeImage: (id) => setImages((a) => a.filter((x) => x.id !== id)),
      clearNotice: () => setNotice(null),
      openWorkspace: (tab, agentId) => {
        if (tab === "files") {
          const newest = collectFiles(runs).at(-1);
          setPanel((p) => (newest ? withTab(p, fileTab(newest.path), true) : { ...p, open: true, active: p.active ?? p.tabs[0] ?? null }));
        } else if (tab === "agent") setPanel((p) => (agentId ? withTab(p, agentTab(agentId), true) : p));
        else if (tab === "browser") setPipState({ open: true, expanded: true });
        else setPanel((p) => withTab(p, tab, true));
      },
      closeWorkspace: closePanel,
    }),
    [sessionId, adoptBrowser, mode, setMode, drafts, pendingPlan, approvePlan, cancelPlan, stage, openStage, closeStage, open, busy, runs, attachments, images, model, notice, panel, pip, setPip, reorderTabs, localFiles, stored, liveViewUrl, page, focusTick, toggle, send, stop, newChat, addAttachment, addImages, setModel, openTab, closeTab, closePanel, openApp, openLocalFile, rememberFiles],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
