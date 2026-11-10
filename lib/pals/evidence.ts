import type { FetchedPage } from "./rival";

export interface Evidence {
  url: string;
  operator?: "tavily" | "exa";
  fetchedAtMs: number;
  quote: string;
}

/**
 * Pure. One cited line about `company` from the pages a search returned. The quote is a verbatim slice of the page text (so it
 * is a substring by construction), 8..200 characters, and the time and operator are the fetcher's. null when no page mentions
 * the company: a SuperPal with no evidence says so; it never invents a source.
 */
export function pickEvidence(company: string, pages: readonly FetchedPage[]): Evidence | null {
  const needle = company.toLowerCase();
  for (const p of pages) {
    const i = p.text.toLowerCase().indexOf(needle);
    if (i < 0) continue;
    const quote = p.text.slice(Math.max(0, i - 40), i + 160).replace(/\s+/g, " ").trim();
    const verbatim = p.text.includes(quote) ? quote : p.text.slice(i, i + 160).trim();
    if (verbatim.length >= 8 && p.text.includes(verbatim)) return { url: p.url, operator: p.operator, fetchedAtMs: p.fetchedAtMs, quote: verbatim.slice(0, 200) };
  }
  return null;
}
