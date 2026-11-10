import type { Handoff } from "@/lib/browse/handoff";
import type { LiveBrowser } from "@/lib/integrations/kbrowser";
import type { WebSource } from "@/lib/integrations/types";
import { segmentCitations } from "@/lib/research/citations";
import type { PromiseRunLog } from "@/lib/pals/measure";
import { canonicalUrl, hostOf, type Source } from "@/lib/research/sources";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** One workspace: one cloud VM (opened lazily), one numbering of sources shared by every agent, the chat history. */
export interface Session {
  id: string;
  vm: LiveBrowser | null;
  vmOpening: Promise<LiveBrowser | null> | null;
  /** When Kernel last confirmed the browser is still there (ms). */
  vmCheckedAt?: number;
  /** The browser agent stopped for the person and is waiting for them to say to carry on. */
  handoff?: Handoff;
  sources: Source[];
  history: HistoryTurn[];
  busy: boolean;
  lastUsed: number;
  seq: number; // agent id counter
  /** Files the agents wrote this conversation (CSV, markdown). They are the shared notes later answers are built from. */
  files: Record<string, string>;
  /** Pages opened in the live browser by readers this conversation (it is slow and shared, so it is capped). */
  browserReads: number;
  lastPromiseRun?: PromiseRunLog; // what PromisePal last really did; RivalPal measures the exam against it
}

export const MAX_SOURCES = 30;
export const IDLE_MS = 8 * 60_000;
const MAX_HISTORY = 8;

/**
 * Pure. Merges found pages into the session's numbered list (same page -> same number) and returns, per input,
 * its global number (0 = dropped because the list is full). Numbers never change once assigned, so earlier [n] stay valid.
 */
export function mergeInto(list: Source[], found: WebSource[], max = MAX_SOURCES): { sources: Source[]; map: number[] } {
  const sources = [...list];
  const byKey = new Map(sources.map((s) => [canonicalUrl(s.url), s.n]));
  const map = found.map((f) => {
    const key = canonicalUrl(f.url);
    const have = byKey.get(key);
    if (have) return have;
    if (sources.length >= max) return 0;
    const n = sources.length + 1;
    sources.push({ ...f, n, host: hostOf(f.url) });
    byKey.set(key, n);
    return n;
  });
  return { sources, map };
}

/** Pure. Rewrites [n]/【n】 markers through `map` (local n -> global n); markers that map to nothing are removed. */
export function remapCitations(text: string, map: number[]): string {
  return segmentCitations(text, map.length)
    .map((s) => (s.kind === "text" ? s.text : s.ns.map((n) => map[n - 1]).filter((g) => g > 0).map((g) => `[${g}]`).join("")))
    .join("");
}

/** Pure. Last few exchanges, each clipped, newest last: enough for "do the second one" without blowing the TPM budget. */
export function pushHistory(h: HistoryTurn[], turn: HistoryTurn): HistoryTurn[] {
  return [...h, { role: turn.role, content: turn.content.slice(0, 1500) }].slice(-MAX_HISTORY);
}

// Kept on globalThis, like the other stores: Next re-creates a module when a route compiles or a file changes (in development) and bundles each route
// separately, and /api/agent and /api/browser must see the same conversations.
const g = globalThis as unknown as { __spSessions?: Map<string, Session>; __spReaper?: ReturnType<typeof setInterval> };
const sessions = (g.__spSessions ??= new Map<string, Session>());

/** The session with this id if it is still alive; never creates one. */
export const findSession = (id: string): Session | undefined => sessions.get(id);
export function getSession(id: string | undefined, close: (vmId: string) => Promise<void>): Session {
  const found = id ? sessions.get(id) : undefined;
  const s: Session = found ?? { id: crypto.randomUUID(), vm: null, vmOpening: null, sources: [], history: [], files: {}, browserReads: 0, busy: false, lastUsed: Date.now(), seq: 0 };
  s.lastUsed = Date.now();
  sessions.set(s.id, s);
  g.__spReaper ??= setInterval(() => {
    for (const x of sessions.values())
      if (!x.busy && Date.now() - x.lastUsed > IDLE_MS) void endSession(x.id, close);
  }, 60_000);
  g.__spReaper.unref?.();
  return s;
}

export async function endSession(id: string, close: (vmId: string) => Promise<void>): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.vm) await close(s.vm.id).catch(() => undefined);
  return true;
}

export const hasSession = (id: string): boolean => sessions.has(id);
