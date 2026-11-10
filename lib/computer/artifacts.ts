import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import type { Session } from "./session";
import { diffLines } from "./diff";

const MAX_FILES = 40;
const MAX_FILE = 60_000;
/** How much of a file travels with its `file` event: enough to open it in the artifact panel. */
export const PREVIEW_CHARS = 20_000;
const MAX_TOTAL = 400_000;

type Cell = string | number | boolean | null | undefined;

/**
 * Pure. RFC 4180 CSV. A cell that starts with = + - @ is prefixed with a quote so a spreadsheet opening the file cannot run it as a
 * formula (the cells come from web pages, which are untrusted).
 */
export function csvOf(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const cell = (v: Cell): string => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** Pure. A safe file name inside the artifacts folder: letters, digits, dot, dash, underscore, one level of folder. */
export function artifactPath(name: string): string | null {
  const clean = name.replace(/^\/+/, "");
  return /^(?:[a-z0-9_-]{1,24}\/)?[a-z0-9][a-z0-9._-]{0,60}\.(?:csv|md|json|txt)$/i.test(clean) ? `artifacts/${clean}` : null;
}

/** Pure. Whether a write fits: a file cap, a per-file cap and a total cap. Over the limit, the oldest file is dropped to make room. */
export function putFile(files: Readonly<Record<string, string>>, path: string, content: string): { files: Record<string, string>; created: boolean; adds: number; removes: number } | null {
  const body = content.length > MAX_FILE ? `${content.slice(0, MAX_FILE)}\n…[cut at ${MAX_FILE} characters]\n` : content;
  const old = files[path];
  const next: Record<string, string> = { ...files };
  delete next[path];
  next[path] = body;
  let keys = Object.keys(next);
  while ((keys.length > MAX_FILES || keys.reduce((n, k) => n + next[k].length, 0) > MAX_TOTAL) && keys.length > 1) {
    delete next[keys[0]];
    keys = Object.keys(next);
  }
  if (!(path in next)) return null;
  const { adds, removes } = diffLines(old ?? "", body, { maxLines: 10 });
  return { files: next, created: old === undefined, adds, removes };
}

/**
 * Writes a file into the conversation's workspace and shows it ("Created sources.csv +12 -0"). It is kept in the session so later
 * prompts can read it, and mirrored into the cloud computer when one is already running so TerminalPal can use it too. Best effort:
 * a mirror failure never loses the file.
 */
export async function* writeArtifact(ctx: SubCtx, name: string, content: string): AsyncGenerator<CEvent, boolean> {
  const path = artifactPath(name);
  if (!path) return false;
  const before = ctx.session.files[path] ?? "";
  const r = putFile(ctx.session.files, path, content);
  if (!r) return false;
  ctx.session.files = r.files;
  const d = diffLines(before, r.files[path]);
  yield { kind: "file", agent: ctx.agent, id: path, path: `/workspace/${path}`, created: r.created, adds: r.adds, removes: r.removes, preview: r.files[path].slice(0, PREVIEW_CHARS), patch: d.lines, cut: d.cut, mode: "write" };
  const vm = ctx.session.vm;
  if (vm) {
    try {
      await ctx.deps.term.write(vm.id, `/workspace/${path}`, r.files[path]);
    } catch {
      /* the session copy is the source of truth */
    }
  }
  return true;
}

/**
 * Pure. What the planner sees of the workspace: each file with its first lines (a CSV shows its header and first rows), capped. This is
 * how a CSV written during research becomes context for the next step and the final answer.
 */
export function workspaceDigest(files: Readonly<Record<string, string>>, maxChars = 2200): string {
  const names = Object.keys(files);
  if (names.length === 0) return "(no files yet)";
  const per = Math.max(240, Math.floor(maxChars / Math.min(names.length, 6)));
  return names
    .slice(-6)
    .map((n) => {
      const lines = files[n].split("\n");
      const head = lines.slice(0, n.endsWith(".csv") ? 7 : 8).join("\n");
      return `## ${n} (${lines.length - 1} lines)\n${head.slice(0, per)}`;
    })
    .join("\n\n")
    .slice(0, maxChars);
}

export const sessionFiles = (s: Pick<Session, "files">): string[] => Object.keys(s.files);

/** Pure. Parses the CSV this module writes (quoted cells, doubled quotes, newlines inside quotes) back into rows, for the Files tab. */
export function parseCsv(text: string, maxRows = 40): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (rows.length < maxRows && (cell !== "" || row.length > 0)) { row.push(cell); rows.push(row); }
  return rows;
}
