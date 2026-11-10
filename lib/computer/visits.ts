import { canonicalUrl } from "@/lib/research/sources";
import type { CEvent, RunState } from "./events";

export type VisitEvent = Extract<CEvent, { kind: "visit" }>;
export interface Visit {
  id: string;
  agent: string;
  action: "search" | "read";
  label: string;
  url?: string;
  title?: string;
  via?: "tavily" | "exa" | "fetch" | "browser" | "terminal";
  state: RunState;
  count?: number;
}

/** Pure. The host of a URL without "www.", or "" for anything that is not a URL. */
export function hostOfUrl(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Pure. A letter tile for a site: no favicon service, no remote image (D-UI). The same host always gets the same colour. */
export function avatarOf(host: string): { letter: string; hue: number } {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { letter: (host.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase(), hue: h };
}

export const searchVisit = (agent: string, id: string, query: string, via: "tavily" | "exa", state: RunState, count?: number): VisitEvent =>
  ({ kind: "visit", agent, id, action: "search", label: query.slice(0, 160), via, state, ...(count !== undefined ? { count } : {}) });
export const readVisit = (agent: string, url: string, title: string | undefined, via: Visit["via"], state: RunState = "ok"): VisitEvent =>
  ({ kind: "visit", agent, id: `read:${canonicalKey(url)}`, action: "read", label: hostOfUrl(url) || url, url, ...(title ? { title: title.slice(0, 120) } : {}), via, state });

function canonicalKey(u: string): string {
  try {
    return canonicalUrl(u);
  } catch {
    return u;
  }
}

export interface Grouped {
  searches: Visit[];
  hosts: { host: string; pages: Visit[] }[];
  /** Distinct pages read, by canonical URL. This is what "N sources" counts: everything looked at, not only what was cited. */
  pages: number;
}
/** Pure. Searches in order; pages read grouped by host (first seen first). */
export function groupVisits(visits: readonly Visit[]): Grouped {
  const searches = visits.filter((v) => v.action === "search");
  const reads = visits.filter((v) => v.action === "read" && v.url);
  const byHost = new Map<string, Visit[]>();
  const seen = new Set<string>();
  for (const v of reads) {
    const key = canonicalKey(v.url!);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostOfUrl(v.url) || "unknown";
    byHost.set(host, [...(byHost.get(host) ?? []), v]);
  }
  return { searches, hosts: [...byHost.entries()].map(([host, pages]) => ({ host, pages })), pages: seen.size };
}
