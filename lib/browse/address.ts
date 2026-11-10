/**
 * What a person types in the address bar of the app's browser: a web address, or words to search for. Same idea as a browser's address bar.
 * Only http and https can be opened; anything else with a scheme (javascript:, file:, data:, chrome:) is refused rather than searched for.
 */
export type Address = { ok: true; url: string; search: boolean } | { ok: false; reason: string };

export const SEARCH_URL = "https://www.google.com/search?q=";
const MAX = 2000;
const HOST = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?::\d{2,5})?(?:[/?#].*)?$/i;

export function normalizeAddress(raw: string): Address {
  const t = raw.trim();
  if (!t) return { ok: false, reason: "Type a web address or something to search for." };
  if (t.length > MAX) return { ok: false, reason: "That address is too long." };
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d{2,5}(?:[/?#]|$))/i.exec(t);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== "http" && s !== "https") return { ok: false, reason: `Only http and https pages can be opened (not ${s}:).` };
    try {
      const u = new URL(t);
      return u.hostname ? { ok: true, url: u.toString(), search: false } : { ok: false, reason: "That address has no website name." };
    } catch {
      return { ok: false, reason: "That is not a valid web address." };
    }
  }
  if (!/\s/.test(t) && HOST.test(t)) {
    const local = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(t);
    try {
      return { ok: true, url: new URL(`${local ? "http" : "https"}://${t}`).toString(), search: false };
    } catch {
      /* falls through to a search */
    }
  }
  return { ok: true, url: `${SEARCH_URL}${encodeURIComponent(t)}`, search: true };
}
