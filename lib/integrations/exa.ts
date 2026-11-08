import { z } from "zod";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn } from "./registry";
import { isHttpUrl } from "./url-guard";
import type { AdapterResult, WebSource } from "./types";

const BASE = "https://api.exa.ai"; // POST /search, header `x-api-key` (docs.exa.ai/reference/search). contents.highlights returns excerpts.

const Result = z.object({
  title: z.string().nullish(),
  url: z.string(),
  publishedDate: z.string().nullish(),
  highlights: z.array(z.string()).optional(),
});
const Body = z.object({ results: z.array(Result) });

/** Pure. A row with no highlight text is dropped: a citation with nothing behind it is worse than none. */
export function parseExa(body: unknown): WebSource[] {
  const p = Body.safeParse(body);
  if (!p.success) return [];
  return p.data.results.flatMap((r) => {
    const snippet = (r.highlights ?? []).map((h) => h.trim()).filter(Boolean).join(" [...] ");
    return isHttpUrl(r.url) && snippet
      ? [{ url: r.url, title: r.title?.trim() || r.url, snippet, publishedDate: r.publishedDate ?? null, provider: "exa" as const, score: null }]
      : [];
  });
}

export async function exaSearch(query: string, signal?: AbortSignal, numResults = 6): Promise<AdapterResult<WebSource[]>> {
  if (!isOn("exa")) return degrade("exa off");
  return guard("exa", async () => {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": getEnv().EXA_API_KEY ?? "" },
      body: JSON.stringify({ query, type: "auto", numResults, contents: { highlights: true } }),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!res.ok) return degrade(`exa http ${res.status}`);
    const data = parseExa(await res.json());
    return data.length ? { ok: true, data } : degrade("exa no results");
  });
}
