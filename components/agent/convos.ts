import type { ConvoMeta } from "@/components/shell/history";
import type { ArenaState, Run } from "@/lib/computer/run";

/**
 * Conversations kept in this browser, so chats, battles and loops can be listed in the sidebar and opened again. Pure apart from the storage it is
 * handed (the browser's localStorage, or a stand-in in tests). A saved conversation is a trimmed copy of its runs: the model's thinking, long
 * terminal output and file diffs are dropped, because what a person comes back for is the answer, the sources and the results.
 */
export const INDEX_KEY = "sp-convos";
export const BODY_PREFIX = "sp-convo:";
export const MAX_CONVOS = 60;
/** Characters, not bytes; browsers allow about five million. Leave room for the artifacts and settings stored beside. */
export const BUDGET_CHARS = 2_800_000;
export const BODY_CAP = 450_000;

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface ConvoEntry extends ConvoMeta {
  /** Characters the saved body takes. */
  size: number;
}
export interface StoredConvo {
  id: string;
  runs: Run[];
  /** The server's id for the conversation, so a reopened chat can go on in the same cloud computer while it still exists. */
  sessionId: string | null;
  savedAt: number;
}

const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Pure. A short title from the first thing that was asked. */
export function titleOf(runs: readonly Pick<Run, "prompt">[]): string {
  const t = (runs[0]?.prompt ?? "").replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t || "Untitled" : `${t.slice(0, 57).trimEnd()}…`;
}

/** Pure. Every kind of run the conversation holds, in the order they first appear. */
export function kindsOf(runs: readonly Pick<Run, "arena">[]): ("chat" | "battle" | "loop")[] {
  const out: ("chat" | "battle" | "loop")[] = [];
  for (const r of runs) {
    const k = r.arena ? r.arena.mode : "chat";
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ["chat"];
}

/** Pure. Where the conversation stands, from its latest run. */
export function statusOf(runs: readonly Pick<Run, "status" | "handoff">[]): ConvoMeta["status"] {
  const last = runs.at(-1);
  if (!last) return "done";
  return last.status === "running" ? "running" : last.handoff ? "waiting" : last.status === "error" ? "error" : "done";
}

function trimArena(a: ArenaState): ArenaState {
  return { ...a, contenders: a.contenders.map((c) => ({ ...c, run: trimRun(c.run, 1) })) };
}

/**
 * Pure. A run as it is saved. A run that was still going when it was saved did not finish as far as the saved copy can tell, so it says so; the
 * live copy on screen is untouched. `level` 1 trims harder (for a contender's run inside a Battle, and when a conversation is still too big).
 */
export function trimRun(r: Run, level: 0 | 1 = 0): Run {
  const out = level ? 300 : 800;
  const preview = level ? 600 : 2000;
  const unfinished = r.status === "running";
  return {
    ...r,
    images: undefined, // the thumbnails are addresses that die with the page
    liveViewUrl: undefined, // so is the browser behind it
    ...(unfinished ? { status: "error" as const, error: "This run was interrupted when the page closed." } : {}),
    agents: r.agents.map((a) => ({
      ...a,
      reasoning: "",
      steps: a.steps.slice(level ? -20 : -60),
      terms: a.terms.slice(level ? -2 : -6).map((t) => ({ ...t, out: t.out.slice(-out) })),
      files: a.files.slice(level ? -6 : -12).map((f) => ({ ...f, preview: cap(f.preview, preview), patch: undefined, cut: undefined })),
    })),
    visits: r.visits.slice(level ? -20 : -60),
    arena: r.arena ? trimArena(r.arena) : undefined,
  };
}

/** Pure. A short fingerprint of what a conversation shows. Equal fingerprints mean nothing that is saved has changed, so there is nothing to write. */
export const sigOf = (runs: readonly Run[]): string =>
  runs.map((r) => `${r.id}:${r.status}:${r.answer.length}:${r.agents.length}:${r.sources.length}:${r.visits.length}:${r.arena?.phase ?? ""}:${r.arena?.matches.length ?? 0}:${r.arena?.final ? 1 : 0}`).join("|");

/** Pure. The index entry for a conversation. */
export function metaOf(id: string, runs: readonly Run[], createdAt: number, updatedAt: number, size: number): ConvoEntry {
  return { id, title: titleOf(runs), kinds: kindsOf(runs), createdAt, updatedAt, runs: runs.length, status: statusOf(runs), size };
}

const sane = (v: unknown): v is ConvoEntry => !!v && typeof v === "object" && typeof (v as ConvoEntry).id === "string" && typeof (v as ConvoEntry).title === "string" && typeof (v as ConvoEntry).updatedAt === "number";

/** The conversations, newest first. Anything that does not look like an entry is dropped. */
export function readIndex(kv: KV): ConvoEntry[] {
  try {
    const j: unknown = JSON.parse(kv.getItem(INDEX_KEY) ?? "[]");
    if (!Array.isArray(j)) return [];
    return j.filter(sane).map((e) => ({ ...e, kinds: Array.isArray(e.kinds) && e.kinds.length ? e.kinds : (["chat"] as ConvoEntry["kinds"]), size: typeof e.size === "number" ? e.size : 0, createdAt: typeof e.createdAt === "number" ? e.createdAt : e.updatedAt, runs: typeof e.runs === "number" ? e.runs : 1 })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVOS);
  } catch {
    return [];
  }
}

function writeIndex(kv: KV, list: readonly ConvoEntry[]): void {
  kv.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Pure. A saved run made safe to draw: the fields every part of the screen reads exist, whatever was stored. */
function mend(r: unknown): Run | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Partial<Run>;
  if (typeof x.id !== "string" || typeof x.prompt !== "string") return null;
  const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return { ...(x as Run), attachments: arr(x.attachments), agents: arr(x.agents), messages: arr(x.messages), timeline: arr(x.timeline), sources: arr(x.sources), used: arr(x.used), visits: arr(x.visits), spawns: arr(x.spawns), answer: typeof x.answer === "string" ? x.answer : "", status: x.status === "done" ? "done" : "error" };
}

/** A saved conversation, or null when it is missing or unreadable. */
export function loadConvo(kv: KV, id: string): StoredConvo | null {
  try {
    const j = JSON.parse(kv.getItem(BODY_PREFIX + id) ?? "null") as Partial<StoredConvo> | null;
    if (!j || !Array.isArray(j.runs)) return null;
    const runs = j.runs.flatMap((r) => { const m = mend(r); return m ? [m] : []; });
    return runs.length ? { id, runs, sessionId: typeof j.sessionId === "string" ? j.sessionId : null, savedAt: typeof j.savedAt === "number" ? j.savedAt : 0 } : null;
  } catch {
    return null;
  }
}

/** Takes conversations out of the index and the storage. */
export function removeConvos(kv: KV, ids: readonly string[]): void {
  const gone = new Set(ids);
  for (const id of gone) kv.removeItem(BODY_PREFIX + id);
  writeIndex(kv, readIndex(kv).filter((e) => !gone.has(e.id)));
}

/** Gives a conversation a new title (kept to 80 characters). A blank title is ignored. */
export function renameConvo(kv: KV, id: string, title: string): void {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!t) return;
  writeIndex(kv, readIndex(kv).map((e) => (e.id === id ? { ...e, title: t } : e)));
}

/** The body that is stored: the runs trimmed, harder if the conversation is still too big, the oldest runs dropped as a last resort. */
export function bodyOf(runs: readonly Run[], sessionId: string | null, now: number, id: string): { text: string; runs: Run[] } {
  let kept = runs.map((r) => trimRun(r, 0));
  let text = JSON.stringify({ id, runs: kept, sessionId, savedAt: now });
  if (text.length > BODY_CAP) {
    kept = runs.map((r) => trimRun(r, 1));
    text = JSON.stringify({ id, runs: kept, sessionId, savedAt: now });
  }
  while (text.length > BODY_CAP && kept.length > 1) {
    kept = kept.slice(1);
    text = JSON.stringify({ id, runs: kept, sessionId, savedAt: now });
  }
  return { text, runs: kept };
}

/**
 * Saves a conversation and its index entry. If the storage is full the oldest other conversations are removed until it fits; if it still does not fit,
 * nothing is changed and null comes back (the conversation stays on screen, it is just not remembered).
 */
export function saveConvo(kv: KV, c: { id: string; runs: readonly Run[]; sessionId: string | null; createdAt?: number }, now: number): ConvoEntry | null {
  if (c.runs.length === 0) return null;
  const { text } = bodyOf(c.runs, c.sessionId, now, c.id);
  const before = readIndex(kv);
  const mine = before.find((e) => e.id === c.id);
  const entry = metaOf(c.id, c.runs, mine?.createdAt ?? c.createdAt ?? now, now, text.length);
  // under the total budget first: drop the oldest others
  let others = before.filter((e) => e.id !== c.id);
  const dropped: string[] = [];
  const total = () => others.reduce((n, e) => n + e.size, 0) + entry.size;
  while ((others.length >= MAX_CONVOS || total() > BUDGET_CHARS) && others.length > 0) {
    const oldest = others.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
    dropped.push(oldest.id);
    others = others.filter((e) => e.id !== oldest.id);
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      kv.setItem(BODY_PREFIX + c.id, text);
      for (const id of dropped) kv.removeItem(BODY_PREFIX + id);
      writeIndex(kv, [entry, ...others]);
      return entry;
    } catch {
      // the browser refused: make room by letting go of the oldest other conversation and try again
      if (others.length === 0) break;
      const oldest = others.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
      dropped.push(oldest.id);
      others = others.filter((e) => e.id !== oldest.id);
      try { kv.removeItem(BODY_PREFIX + oldest.id); } catch { /* nothing more to do */ }
    }
  }
  return null;
}
