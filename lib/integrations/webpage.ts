import { htmlToText } from "@/lib/research/htmltext";
import { assertPublicHttpUrl } from "./url-guard";
import { degrade, guard } from "./registry";
import type { AdapterResult } from "./types";

const MAX_BYTES = 400_000;
const MAX_HOPS = 3;
const TIMEOUT_MS = 8_000;
const TEXTY = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json)|application\/[a-z.+-]*json)/i;

export interface PageText {
  text: string;
  status: number;
  finalUrl: string;
}

/**
 * Reads one public web page as text. SSRF-guarded at EVERY hop (redirects are followed by hand and re-validated), text-like content
 * types only, a hard size and time cap. A non-2xx answer is a degrade, not a throw, so the caller can fall back to the browser.
 */
export async function fetchPageText(url: string, signal?: AbortSignal): Promise<AdapterResult<PageText>> {
  return guard("webfetch", async () => {
    let current: string;
    try {
      current = assertPublicHttpUrl(url);
    } catch (e) {
      return degrade(`blocked: ${e instanceof Error ? e.message : "bad url"}`);
    }
    const sig = signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const res = await fetch(current, { redirect: "manual", signal: sig, headers: { "user-agent": "UltraPals/1.0 (+research reader)", accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return degrade(`http ${res.status} without a location`);
        try {
          current = assertPublicHttpUrl(new URL(loc, current).toString());
        } catch (e) {
          return degrade(`blocked redirect: ${e instanceof Error ? e.message : "bad url"}`);
        }
        continue;
      }
      if (!res.ok) return degrade(`http ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !TEXTY.test(type)) return degrade(`not text (${type.split(";")[0]})`);
      const reader = res.body?.getReader();
      if (!reader) return degrade("empty body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size >= MAX_BYTES) {
          reader.cancel().catch(() => undefined);
          break;
        }
      }
      const raw = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      return { ok: true, data: { text: htmlToText(raw), status: res.status, finalUrl: current } };
    }
    return degrade("too many redirects");
  });
}
