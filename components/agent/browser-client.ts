import type { BrowserState } from "@/lib/integrations/kbrowser";

/** What /api/browser answers. `alive: false` means the browser is gone; a failed request is not that, it is `ok: false` with `alive: true`. */
export interface BrowserReply {
  alive: boolean;
  ok?: boolean;
  error?: string;
  state?: BrowserState;
  search?: boolean;
  liveViewUrl?: string;
}
export type BrowserOp = { op: "open" } | { op: "goto"; address: string } | { op: "back" } | { op: "forward" } | { op: "reload" };
type Fetch = typeof fetch;

const NETWORK: BrowserReply = { alive: true, ok: false, error: "Could not reach the app. Check your connection." };

async function read(res: Response): Promise<BrowserReply> {
  const j = (await res.json().catch(() => null)) as Partial<BrowserReply> | null;
  if (!j || typeof j !== "object") return { alive: true, ok: false, error: `The app answered with an error (${res.status}).` };
  // the browser is gone only when the server says so: a rate limit or a bad request says nothing about it
  return { ...j, alive: j.alive !== false, ...(res.ok ? {} : { ok: false, error: j.error ?? `Request failed (${res.status}).` }) };
}

/** Where the browser is now. A network error is reported as "could not reach the app", never as "the browser closed". */
export async function browserGet(sessionId: string, f: Fetch = fetch): Promise<BrowserReply> {
  try {
    return await read(await f(`/api/browser?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }));
  } catch {
    return NETWORK;
  }
}

export async function browserPost(sessionId: string, op: BrowserOp, f: Fetch = fetch): Promise<BrowserReply> {
  try {
    return await read(await f("/api/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...op }) }));
  } catch {
    return NETWORK;
  }
}

/** Pure. An address as shown when the box is not being edited: no scheme, no "www.", no lone trailing slash. */
export function displayAddress(url: string): string {
  if (!url || url === "about:blank") return "";
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** Pure. The site name for the window's title bar. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
