import type { ChatMessage } from "@/lib/integrations/chat";
import type { WebSource } from "@/lib/integrations/types";

export interface Source extends WebSource {
  n: number; // 1-based citation number the model and the UI both use
  host: string;
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_)/i;

export const hostOf = (u: string): string => new URL(u).hostname.replace(/^www\./, "");

/** Pure. Same page, different tracking params / fragment / trailing slash -> same key. */
export function canonicalUrl(u: string): string {
  const x = new URL(u);
  for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
  return `${x.protocol}//${hostOf(u)}${x.pathname.replace(/\/+$/, "")}${x.search}`;
}

/**
 * Pure. Round-robin across providers (their scores are not comparable), first sighting of a page wins,
 * a duplicate only lends its snippet if it is longer. Numbers are assigned last, so [n] is stable for the whole answer.
 */
export function mergeSources(lists: WebSource[][], max = 8): Source[] {
  const seen = new Map<string, WebSource>();
  for (let i = 0; seen.size < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const s = l[i];
      if (!s) continue;
      const key = canonicalUrl(s.url);
      const prev = seen.get(key);
      if (!prev) seen.size < max && seen.set(key, s);
      else if (s.snippet.length > prev.snippet.length) seen.set(key, { ...prev, snippet: s.snippet });
    }
  }
  return [...seen.values()].map((s, i) => ({ ...s, n: i + 1, host: hostOf(s.url) }));
}

/** Pure. Groq's free tier is ~8K tokens/minute, so the prompt is budgeted in characters (~4 chars/token). */
export function trimSources(sources: Source[], totalChars = 9_000, perSource = 1_500): Source[] {
  const per = Math.min(perSource, Math.floor(totalChars / Math.max(sources.length, 1)));
  return sources.map((s) => (s.snippet.length > per ? { ...s, snippet: `${s.snippet.slice(0, per).trimEnd()}…` } : s));
}

export const SYSTEM_PROMPT =
  "You are a careful research assistant. Answer using ONLY the numbered sources. " +
  "Cite every factual claim inline as [n] immediately after the claim, e.g. [1] or [2][3]. " +
  "Use ONLY plain square brackets with the source number: never 【】, never †, never line ranges, never URLs in the text. " +
  "If the sources do not contain the answer, say so plainly instead of guessing. " +
  "Be concise: a short paragraph or a short list. Never invent sources, numbers or URLs.";

export function buildMessages(question: string, sources: Source[]): ChatMessage[] {
  const block = sources.map((s) => `[${s.n}] ${s.title} (${s.host})\n${s.snippet}`).join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Question: ${question}\n\nSources:\n${block}` },
  ];
}
