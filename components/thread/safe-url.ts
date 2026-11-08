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

/** Any absolute URL -> its bare host ("www." stripped). Local letter tile uses its first character; no favicon service (rule 20). */
export const hostLabel = (u: URL): string => u.hostname.replace(/^www\./, "");
