/** Trace args and evidence URLs are data, not trusted markup. Only http(s) ever becomes an <a href>. */
export function safeHttpUrl(u: unknown): URL | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

import type { TraceEvent } from "@/lib/agent/types";

/** Any absolute URL -> its bare host ("www." stripped). Local letter tile uses its first character; no favicon service (rule 20). */
export const hostLabel = (u: URL): string => u.hostname.replace(/^www\./, "");

export interface TraceSource {
  url: URL;
  host: string;
}

/** Evidence links found in trace tool args (kernel.observe, fetch.page, ...). De-duplicated by href; only http(s) survives. */
export function sourcesFromTrace(events: TraceEvent[]): TraceSource[] {
  const seen = new Map<string, URL>();
  for (const e of events) {
    if (e.kind !== "tool") continue;
    for (const v of Object.values(e.args ?? {})) {
      const u = safeHttpUrl(v);
      if (u) seen.set(u.href, u);
    }
  }
  return [...seen.values()].map((u) => ({ url: u, host: hostLabel(u) }));
}
