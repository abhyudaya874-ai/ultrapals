import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Rule 20: the browser talks to TWO domains (the app, the PayPal sandbox approval page). No CDN, no remote fonts, no remote avatars.
// "www.w3.org" is the SVG xmlns, which is a namespace string and not a request.
const ALLOWED_HOSTS = new Set(["www.w3.org"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = ["app", "components"].flatMap(walk).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));

describe("browser-visible origins", () => {
  it("no source file names a third-party host", () => {
    const hits: string[] = [];
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!ALLOWED_HOSTS.has(m[1].toLowerCase())) hits.push(`${f}: ${m[0]}`);
    expect(hits).toEqual([]);
  });
  it("no @import url(...), no remote <link>, no favicon/avatar services", () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/@import\s+url\(/i.test(src)) hits.push(`${f}: @import url(`);
      if (/<link[^>]+href=["']https?:/i.test(src)) hits.push(`${f}: remote <link>`);
      if (/google\.com\/s2\/favicons|gravatar|unpkg|jsdelivr|cdnjs/i.test(src)) hits.push(`${f}: CDN or favicon service`);
    }
    expect(hits).toEqual([]);
  });
});
