import type { FileEdit, Run } from "@/lib/computer/run";

/** Tab ids of the artifact panel. One id per tab, so a file written twice is one tab. */
export const FIXED_TABS = ["browser", "terminal", "sources"] as const;
export const fileTab = (path: string): string => `file:${path}`;
export const appTab = (name: string): string => `app:${name}`;
export const agentTab = (id: string): string => `agent:${id}`;
export const chartTab = (id: string): string => `chart:${id}`;

export type TabRef = { kind: "browser" | "terminal" | "sources" } | { kind: "file"; path: string } | { kind: "app"; name: AppArtifactName } | { kind: "agent"; id: string } | { kind: "chart"; id: string };

/** The app's own screens, shown as artifacts instead of pages. UltraPal can load the same data with its `open` action. */
export const APP_ARTIFACTS = {
  newsroom: { title: "Newsroom", blurb: "Free and paywalled stories. Premium ones unlock for $0.01 through PromisePal." },
  dashboard: { title: "Dashboard", blurb: "Every verdict the judge has computed, charted." },
  timeline: { title: "Timeline", blurb: "Promise windows on a schedule; drag one to reschedule it." },
  proctor: { title: "Proctor", blurb: "The sandbox canary: scheduled checks that open a case only on a confirmed change." },
} as const;
export type AppArtifactName = keyof typeof APP_ARTIFACTS;
export const isAppArtifact = (n: string): n is AppArtifactName => Object.prototype.hasOwnProperty.call(APP_ARTIFACTS, n);

/** Pure. What a tab id points at; an id that means nothing is null (a stale tab is dropped, never rendered blank). */
export function parseTab(id: string): TabRef | null {
  if ((FIXED_TABS as readonly string[]).includes(id)) return { kind: id as "browser" | "terminal" | "sources" };
  const i = id.indexOf(":");
  if (i < 0) return null;
  const key = id.slice(i + 1);
  if (!key) return null;
  switch (id.slice(0, i)) {
    case "file": return { kind: "file", path: key };
    case "app": return isAppArtifact(key) ? { kind: "app", name: key } : null;
    case "agent": return { kind: "agent", id: key };
    case "chart": return { kind: "chart", id: key };
    default: return null;
  }
}

export type FileKind = "csv" | "md" | "json" | "text";
export const fileKind = (path: string): FileKind => (/\.csv$/i.test(path) ? "csv" : /\.(md|markdown)$/i.test(path) ? "md" : /\.json$/i.test(path) ? "json" : "text");

/** Pure. "/workspace/artifacts/pages/x.md" -> "pages/x.md"; any other workspace path loses only "/workspace/". */
export const displayName = (path: string): string => path.replace(/^\/workspace\//, "").replace(/^artifacts\//, "");
export const baseName = (path: string): string => displayName(path).split("/").pop() ?? path;

export interface FileEntry {
  path: string;
  name: string;
  kind: FileKind;
  /** The newest write (diff + new text), if the file was written. */
  write?: FileEdit;
  /** The newest read, if it was read. */
  read?: FileEdit;
  writes: number;
  reads: number;
  /** The newest text we have for it. */
  content: string;
  agent: string;
}

/** Pure. One entry per path across all runs, in the order files first appeared. */
export function collectFiles(runs: readonly Run[]): FileEntry[] {
  const by = new Map<string, FileEntry>();
  for (const r of runs)
    for (const a of r.agents)
      for (const f of a.files) {
        const cur = by.get(f.path) ?? { path: f.path, name: displayName(f.path), kind: fileKind(f.path), writes: 0, reads: 0, content: "", agent: a.id };
        if (f.mode === "read") { cur.read = f; cur.reads++; if (!cur.write) cur.content = f.preview; }
        else { cur.write = f; cur.writes++; cur.content = f.preview; cur.agent = a.id; }
        by.set(f.path, cur);
      }
  return [...by.values()];
}

/** Pure. "+12 -3" style totals for a set of file events (reads add nothing). */
export function totals(files: readonly FileEdit[]): { adds: number; removes: number } {
  return files.reduce((t, f) => (f.mode === "read" ? t : { adds: t.adds + f.adds, removes: t.removes + f.removes }), { adds: 0, removes: 0 });
}

export interface PanelState {
  open: boolean;
  /** Tab ids, in the order they were opened. */
  tabs: string[];
  active: string | null;
}
export const NO_PANEL: PanelState = { open: false, tabs: [], active: null };

/** Pure. Opens `id` as a tab. `focus` makes it the visible one (and opens the panel); without it a tab is added quietly. */
export function withTab(p: PanelState, id: string, focus: boolean): PanelState {
  const tabs = p.tabs.includes(id) ? p.tabs : [...p.tabs, id];
  return { open: p.open || focus, tabs, active: focus || !p.active ? id : p.active };
}

/** Pure. Closes a tab; the neighbour to its left (or the next one) becomes active, and the panel closes with its last tab. */
export function withoutTab(p: PanelState, id: string): PanelState {
  const i = p.tabs.indexOf(id);
  if (i < 0) return p;
  const tabs = p.tabs.filter((t) => t !== id);
  if (tabs.length === 0) return NO_PANEL;
  return { open: p.open, tabs, active: p.active === id ? tabs[Math.max(0, i - 1)] : p.active };
}

/** Pure. Moves tab `id` so it sits at index `to` (after the move). Unknown ids and out-of-range targets are clamped, never lost. */
export function moveTab(p: PanelState, id: string, to: number): PanelState {
  const from = p.tabs.indexOf(id);
  if (from < 0) return p;
  const rest = p.tabs.filter((t) => t !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  if (at === from) return p;
  return { ...p, tabs: [...rest.slice(0, at), id, ...rest.slice(at)] };
}
