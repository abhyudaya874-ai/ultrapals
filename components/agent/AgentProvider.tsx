"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "@/lib/computer/events";
import { DEFAULT_CHOICE, parseChoice, type ModelChoice } from "@/lib/computer/models";
import { applyCEvent, newRun, parseCStream, type Run } from "@/lib/computer/run";
import { STORE_KEY, mergeStored, parseStored, type StoredFile } from "./artifact-store";
import { prepareImage, refuseFile, type PendingImage } from "./image-prep";
import { NO_PANEL, agentTab, appTab, collectFiles, fileTab, isAppArtifact, parseTab, withTab, withoutTab, type PanelState } from "./panel-model";

/** Kept for callers that still say "open the files tab": it opens the newest file, or just the panel. */
export type WorkspaceTab = "browser" | "terminal" | "files" | "sources" | "agent";

interface AgentCtx {
  open: boolean;
  busy: boolean;
  runs: Run[];
  attachments: Attachment[];
  images: PendingImage[];
  model: ModelChoice;
  /** A short problem to show under the input (an image that could not be attached, a failed send). */
  notice: string | null;
  panel: PanelState;
  /** Files from other sources (an automation's run) opened as tabs; path -> text. */
  localFiles: Record<string, string>;
  /** Files the agents made, remembered in this browser for the Artifacts page. */
  stored: StoredFile[];
  liveViewUrl: string | null;
  page: { url: string; title: string } | null;
  toggle: (force?: boolean) => void;
  send: (message: string) => Promise<void>;
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

const SID = "sp-agent-session";
const MODEL_KEY = "sp-model";
const MAX_SELECTION = 4000;

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [model, setModelState] = useState<ModelChoice>(DEFAULT_CHOICE);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<PanelState>(NO_PANEL);
  const [localFiles, setLocalFiles] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<StoredFile[]>([]);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [page, setPage] = useState<AgentCtx["page"]>(null);
  const [focusTick, setFocusTick] = useState(0);
  const session = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const seenFiles = useRef(new Set<string>());
  const savedSig = useRef("");

  useEffect(() => {
    session.current = sessionStorage.getItem(SID);
    try {
      setModelState(parseChoice(JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null")));
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
    let have = images.length;
    const added: PendingImage[] = [];
    for (const f of files) {
      const why = refuseFile(f, have);
      if (why) { setNotice(why); break; }
      try {
        added.push(await prepareImage(f));
        have++;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That image could not be attached.");
      }
    }
    if (added.length) setImages((x) => [...x, ...added].slice(0, 3));
  }, [images.length]);

  const setModel = useCallback((m: ModelChoice) => {
    setModelState(m);
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); } catch { /* not remembered; still applies to this tab */ }
  }, []);

  const openTab = useCallback((id: string) => setPanel((p) => (parseTab(id) ? withTab(p, id, true) : p)), []);
  const closeTab = useCallback((id: string) => setPanel((p) => withoutTab(p, id)), []);
  const closePanel = useCallback(() => setPanel((p) => ({ ...p, open: false })), []);
  const openApp = useCallback((name: string) => { if (isAppArtifact(name)) setPanel((p) => withTab(p, appTab(name), true)); }, []);
  const openLocalFile = useCallback((path: string, content: string) => {
    setLocalFiles((f) => ({ ...f, [path]: content }));
    setPanel((p) => withTab(p, fileTab(path), true));
  }, []);

  const send = useCallback(async (message: string) => {
    const atts = attachments;
    const pics = images;
    const text = message.trim() || (pics.length ? "Describe the attached image." : "");
    if (text.length < 2 || running.current) return;
    running.current = true;
    const id = crypto.randomUUID();
    const path = `${location.pathname}${location.search}`;
    setAttachments([]);
    setImages([]);
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
        body: JSON.stringify({ sessionId: sessionId ?? undefined, message: text, path, attachments: atts, images: pics.map(({ name, mime, data }) => ({ name, mime, data })), model }),
      });
    try {
      let res = await post(session.current);
      if (res.status === 410) {
        session.current = null;
        sessionStorage.removeItem(SID);
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
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const p = parseCStream((buf += dec.decode(value, { stream: true })));
        buf = p.rest;
        if (!p.events.length) continue;
        for (const e of p.events) {
          if (e.kind === "workspace") {
            setLiveViewUrl(e.liveViewUrl);
            setPanel((w) => withTab(w, "browser", !w.open));
          } else if (e.kind === "page") setPage({ url: e.url, title: e.title });
          else if (e.kind === "term") setPanel((w) => withTab(w, "terminal", false));
          else if (e.kind === "sources" || e.kind === "visit") setPanel((w) => withTab(w, "sources", false));
          else if (e.kind === "open" && isAppArtifact(e.artifact)) setPanel((w) => withTab(w, appTab(e.artifact), true));
          else if (e.kind === "file") {
            // a file the agent writes opens beside the chat the first time it appears; later edits update the same tab
            const first = !seenFiles.current.has(e.path);
            seenFiles.current.add(e.path);
            setPanel((w) => withTab(w, fileTab(e.path), first && e.mode !== "read"));
          }
        }
        patch((r) => p.events.reduce(applyCEvent, r));
      }
      patch((r) => (r.status === "running" ? applyCEvent(r, { kind: "error", message: "The stream ended early." }) : r));
    } catch (e) {
      fail(ctl.signal.aborted ? "Stopped." : e instanceof Error ? e.message : "Network error.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [attachments, images, model]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const newChat = useCallback(() => {
    abort.current?.abort();
    const sid = session.current;
    session.current = null;
    sessionStorage.removeItem(SID);
    if (sid) void fetch(`/api/agent?sessionId=${sid}`, { method: "DELETE" }).catch(() => undefined);
    seenFiles.current = new Set();
    setRuns([]);
    setAttachments([]);
    setImages([]);
    setNotice(null);
    setLiveViewUrl(null);
    setPage(null);
    setPanel(NO_PANEL);
    setLocalFiles({});
  }, []);

  const value = useMemo<AgentCtx>(
    () => ({
      open, busy, runs, attachments, images, model, notice, panel, localFiles, stored, liveViewUrl, page, focusTick,
      toggle, send, stop, newChat, addAttachment, addImages, setModel, openTab, closeTab, closePanel, openApp, openLocalFile,
      removeAttachment: (id) => setAttachments((a) => a.filter((x) => x.id !== id)),
      removeImage: (id) => setImages((a) => a.filter((x) => x.id !== id)),
      clearNotice: () => setNotice(null),
      openWorkspace: (tab, agentId) => {
        if (tab === "files") {
          const newest = collectFiles(runs).at(-1);
          setPanel((p) => (newest ? withTab(p, fileTab(newest.path), true) : { ...p, open: true, active: p.active ?? p.tabs[0] ?? null }));
        } else if (tab === "agent") setPanel((p) => (agentId ? withTab(p, agentTab(agentId), true) : p));
        else setPanel((p) => withTab(p, tab, true));
      },
      closeWorkspace: closePanel,
    }),
    [open, busy, runs, attachments, images, model, notice, panel, localFiles, stored, liveViewUrl, page, focusTick, toggle, send, stop, newChat, addAttachment, addImages, setModel, openTab, closeTab, closePanel, openApp, openLocalFile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
