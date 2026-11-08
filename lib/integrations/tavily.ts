import { z } from "zod";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn } from "./registry";
import { isHttpUrl } from "./url-guard";
import type { AdapterResult, WebSource } from "./types";

const BASE = "https://api.tavily.com"; // POST /search. Auth is `Authorization: Bearer <key>` (docs.tavily.com, search endpoint).

const Result = z.object({
  title: z.string().optional(),
  url: z.string(),
  content: z.string().optional(),
  score: z.number().optional(),
  published_date: z.string().nullish(),
});
const Body = z.object({ results: z.array(Result) });

/** Pure. Drops rows with a non-http(s) url or no usable text; never invents a field. */
export function parseTavily(body: unknown): WebSource[] {
  const p = Body.safeParse(body);
  if (!p.success) return [];
  return p.data.results.flatMap((r) =>
    isHttpUrl(r.url) && r.content?.trim()
      ? [{ url: r.url, title: r.title?.trim() || r.url, snippet: r.content.trim(), publishedDate: r.published_date ?? null, provider: "tavily" as const, score: r.score ?? null }]
      : [],
  );
}

export async function tavilySearch(query: string, signal?: AbortSignal, maxResults = 6): Promise<AdapterResult<WebSource[]>> {
  if (!isOn("tavily")) return degrade("tavily off");
  return guard("tavily", async () => {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getEnv().TAVILY_API_KEY ?? ""}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: maxResults }),
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    if (!res.ok) return degrade(`tavily http ${res.status}`);
    const data = parseTavily(await res.json());
    return data.length ? { ok: true, data } : degrade("tavily no results");
  });
}
