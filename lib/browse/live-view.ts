/**
 * The ONLY third-party origin the page may embed (docs/DECISIONS.md §6, O5): a KERNEL live view.
 * The URL is a server-issued capability token; the host allowlist stops anything else reaching an iframe `src`.
 */
const HOSTS = [/(^|\.)kernel\.sh$/i, /(^|\.)onkernel\.com$/i];

export function safeLiveViewUrl(u: unknown): URL | null {
  if (typeof u !== "string") return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password && HOSTS.some((h) => h.test(x.hostname)) ? x : null;
  } catch {
    return null;
  }
}

/** Pure. `readOnly=true` is the documented query parameter that makes the view non-interactive. */
export function liveViewSrc(u: unknown, readOnly: boolean): string | null {
  const x = safeLiveViewUrl(u);
  if (!x) return null;
  x.searchParams.set("readOnly", String(readOnly));
  return x.toString();
}
