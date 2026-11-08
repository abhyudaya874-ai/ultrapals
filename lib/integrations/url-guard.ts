/**
 * SSRF guard for any user-supplied URL we fetch server-side (page_contains conditions).
 * Pure. Returns the normalised URL or throws. Blocks non-http(s), credentials, localhost and private ranges.
 * Limitation: does not defend against DNS rebinding. Fine for a hackathon demo; say so if asked.
 */
export function assertPublicHttpUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("private host");
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const priv =
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    if (priv) throw new Error("private address");
  }
  if (host.includes(":") && (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) {
    throw new Error("private address");
  }
  return u.toString();
}

/** Pure shape check for URLs a vendor RETURNED (display/citation only). Not an SSRF guard: never fetch these server-side. */
export function isHttpUrl(u: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}
