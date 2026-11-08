"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "@/lib/computer/events";
import { applyCEvent, newRun, parseCStream, type Run } from "@/lib/computer/run";

export type WorkspaceTab = "browser" | "terminal" | "files" | "sources" | "agent";

interface AgentCtx {
  open: boolean;
  busy: boolean;
  runs: Run[];
  attachments: Attachment[];
  workspace: { open: boolean; tab: WorkspaceTab; agentId: string | null };
  liveViewUrl: string | null;
  page: { url: string; title: string } | null;
  toggle: (force?: boolean) => void;
  send: (message: string) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  addAttachment: (text: string, path: string) => void;
  removeAttachment: (id: string) => void;
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
const MAX_SELECTION = 4000;

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<AgentCtx["workspace"]>({ open: false, tab: "browser", agentId: null });
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [page, setPage] = useState<AgentCtx["page"]>(null);
  const [focusTick, setFocusTick] = useState(0);
  const session = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);

  useEffect(() => {
    session.current = sessionStorage.getItem(SID);
  }, []);

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

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (text.length < 2 || running.current) return;
    running.current = true;
    const id = crypto.randomUUID();
    const atts = attachments;
    const path = `${location.pathname}${location.search}`;
    setAttachments([]);
    setRuns((r) => [...r, newRun(id, text, atts)]);
    setBusy(true);
    const ctl = (abort.current = new AbortController());
    const patch = (f: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? f(r) : r)));
    const fail = (m: string) => patch((r) => applyCEvent(r, { kind: "error", message: m }));
    const post = (sessionId: string | null) =>
      fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ sessionId: sessionId ?? undefined, message: text, path, attachments: atts }) });
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
            setWorkspace((w) => (w.open ? w : { open: true, tab: "browser", agentId: null }));
          } else if (e.kind === "page") setPage({ url: e.url, title: e.title });
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
  }, [attachments]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const newChat = useCallback(() => {
    abort.current?.abort();
    const sid = session.current;
    session.current = null;
    sessionStorage.removeItem(SID);
    if (sid) void fetch(`/api/agent?sessionId=${sid}`, { method: "DELETE" }).catch(() => undefined);
    setRuns([]);
    setAttachments([]);
    setLiveViewUrl(null);
    setPage(null);
    setWorkspace({ open: false, tab: "browser", agentId: null });
  }, []);

  const value = useMemo<AgentCtx>(
    () => ({
      open, busy, runs, attachments, workspace, liveViewUrl, page, focusTick, toggle, send, stop, newChat, addAttachment,
      removeAttachment: (id) => setAttachments((a) => a.filter((x) => x.id !== id)),
      openWorkspace: (tab, agentId) => setWorkspace({ open: true, tab, agentId: agentId ?? null }),
      closeWorkspace: () => setWorkspace((w) => ({ ...w, open: false })),
    }),
    [open, busy, runs, attachments, workspace, liveViewUrl, page, focusTick, toggle, send, stop, newChat, addAttachment],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
