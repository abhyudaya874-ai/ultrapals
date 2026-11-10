/** Pure fuzzy matching for the command palette. No DOM. */

/** Score a single scattered-letters match earns. */
const SCATTERED = 15;
const norm = (s: string): string => s.toLowerCase();
const tokens = (q: string): string[] => norm(q).split(/\s+/).filter(Boolean);

/** Pure. 0 = no match; higher is better. Every word of the query must match: at the start of the text, at the start of a word, anywhere, or as scattered letters. */
export function score(query: string, text: string): number {
  const ts = tokens(query);
  if (ts.length === 0) return 1;
  const t = norm(text);
  let total = 0;
  for (const w of ts) {
    const i = t.indexOf(w);
    if (i === 0) total += 100;
    else if (i > 0 && /[\s\-_/.:]/.test(t[i - 1])) total += 80;
    else if (i > 0) total += Math.max(20, 60 - i);
    else if (isSubsequence(w, t)) total += SCATTERED;
    else return 0;
  }
  return total - Math.min(10, Math.floor(text.length / 20)); // among equals, shorter text first
}

function isSubsequence(w: string, t: string): boolean {
  let j = 0;
  for (let i = 0; i < t.length && j < w.length; i++) if (t[i] === w[j]) j++;
  return j === w.length;
}

/** Pure. [start, end) ranges of `text` to highlight for `query` (first occurrence of each word). Ranges never overlap and are sorted. */
export function matchRanges(query: string, text: string): [number, number][] {
  const t = norm(text);
  const out: [number, number][] = [];
  for (const w of tokens(query)) {
    const i = t.indexOf(w);
    if (i >= 0) out.push([i, i + w.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

export interface Rankable { label: string; keywords?: string }
/** Pure. Entries that match, best first; equal scores keep their original order. With no query everything is returned (capped). */
export function rank<T extends Rankable>(query: string, entries: readonly T[], limit = 50): T[] {
  const scored = entries
    .map((e, i) => ({ e, i, s: Math.max(score(query, e.label), tokens(query).length ? score(query, e.keywords ?? "") * 0.6 : 0) }))
    .filter((x) => x.s > 0);
  // scattered-letter matches only help when nothing matches properly; next to real matches they are noise
  const n = tokens(query).length;
  const real = n > 0 && scored.some((x) => x.s > SCATTERED * n);
  return scored
    .filter((x) => !real || x.s > SCATTERED * n)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}
