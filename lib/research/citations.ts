export type Segment = { kind: "text"; text: string } | { kind: "cite"; ns: number[] };

// [1] / [2][3] / [1, 2], plus gpt-oss's native 【3†L1-L4】 and 【3】 (seen live on Groq even when the prompt asks for [n]).
const CITE = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]|【(\d{1,2})(?:†[^】]*)?】/g;

/**
 * Pure. Splits model text into text and citation segments: [1], [2][3], [1, 2] and 【3†L1-L4】 all work.
 * Numbers outside 1..max are dropped from the chip; a marker with no valid number stays as plain text,
 * so a hallucinated [9] never renders as a source we do not have.
 */
export function segmentCitations(text: string, max: number): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    const raw = m[1] !== undefined ? m[1].split(",").map((x) => Number(x.trim())) : [Number(m[2])];
    const ns = [...new Set(raw)].filter((n) => n >= 1 && n <= max);
    if (ns.length === 0) continue;
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "cite", ns });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Pure. Sorted, de-duplicated source numbers the answer actually cites. */
export function usedSources(text: string, max: number): number[] {
  const all = segmentCitations(text, max).flatMap((s) => (s.kind === "cite" ? s.ns : []));
  return [...new Set(all)].sort((a, b) => a - b);
}
