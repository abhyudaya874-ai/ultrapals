export type Align = "left" | "center" | "right";
/** A list item: its own text, and anything nested under it (a sub-list, a second paragraph). */
export interface MdItem {
  text: string;
  sub?: MdBlock[];
}
export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: MdItem[] }
  | { t: "ol"; items: MdItem[]; start: number }
  | { t: "code"; lang: string; text: string }
  | { t: "table"; head: string[]; rows: string[][]; align: Align[] }
  | { t: "quote"; text: string }
  | { t: "hr" };

/** The cells of a table row. A pipe written `\|` stays in its cell, and `<br>` is a line break inside it. Short rows are not padded here. */
const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n").trim());
// one dash is enough in a cell (`:-:` is a centred column); a row with no pipe at all must be a real rule (`---`) to count
const isSep = (line: string): boolean => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && (line.includes("|") || /-{3,}/.test(line));
const alignOf = (c: string): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");

const UL = /^(\s*)[-*+•]\s+(.*)$/;
const OL = /^(\s*)(\d+)[.)]\s+(.*)$/;
const indentOf = (line: string): number => line.length - line.trimStart().length;
interface Marker { kind: "ul" | "ol"; indent: number; text: string; num: number }
function markerOf(line: string): Marker | null {
  const u = UL.exec(line);
  if (u) return { kind: "ul", indent: u[1].length, text: u[2], num: 0 };
  const o = OL.exec(line);
  return o ? { kind: "ol", indent: o[1].length, text: o[3], num: Number(o[2]) } : null;
}

/** Reads one list starting at `start`: items at the same indent, each with whatever is indented under it. Returns the block and the next line. */
function readList(lines: string[], start: number): { block: MdBlock; next: number } {
  const first = markerOf(lines[start])!;
  const base = first.indent;
  const items: MdItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = markerOf(lines[i]);
    if (!m || m.kind !== first.kind || m.indent > base + 1 || m.indent < base - 1) break;
    const item: MdItem = { text: m.text.trim() };
    i++;
    const under: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > base + 1) { under.push(""); i++; continue; }
        break;
      }
      if (indentOf(l) > base + 1) { under.push(l); i++; continue; }
      break;
    }
    if (under.length) {
      const cut = Math.min(...under.filter((l) => l.trim()).map(indentOf));
      const sub = parseMarkdown(under.map((l) => l.slice(Math.min(cut, indentOf(l)))).join("\n"));
      if (sub.length) item.sub = sub;
    }
    items.push(item);
  }
  return { block: first.kind === "ul" ? { t: "ul", items } : { t: "ol", items, start: first.num }, next: i };
}

/** Pure. A small, safe markdown subset (headings, lists with nesting, fenced code, tables with alignment, quotes, rules, paragraphs) as blocks. Nothing here produces HTML. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence (a missing one just ends the block at the end of the text)
      out.push({ t: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push({ t: "h", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      // every row has a cell for every column, so a ragged table still lines up
      out.push({ t: "table", head, rows: rows.map((r) => head.map((_, k) => r[k] ?? "")), align: head.map((_, k) => align[k] ?? "left") });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: q.join("\n") });
      continue;
    }
    if (markerOf(line)) {
      const r = readList(lines, i);
      out.push(r.block);
      i = r.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*```|#{1,6}\s|\s*>|\s*[-*+•]\s|\s*\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isSep(lines[i + 1]))) para.push(lines[i++]);
    if (para.length === 0) { para.push(lines[i++]); } // a line that matched no rule still advances
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

export type Inline =
  | { k: "text"; text: string }
  | { k: "b"; text: string }
  | { k: "i"; text: string }
  | { k: "s"; text: string }
  | { k: "code"; text: string }
  | { k: "a"; text: string; href: string };

// bold, strike, code, a link, then italics with `*` or `_` (not inside a word, not around spaces: 2 * 3 * 4 and snake_case_names stay as they are)
const INLINE = /\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])|(?<!\w)_(?![\s_])([^_\n]+?)(?<![\s_])_(?!\w)/g;

/** Pure. **bold**, *italic*, ~~strike~~, `code` and a markdown link only when it points at a web address; anything else stays plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ k: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ k: "b", text: m[1] });
    else if (m[2] !== undefined) out.push({ k: "s", text: m[2] });
    else if (m[3] !== undefined) out.push({ k: "code", text: m[3] });
    else if (m[4] !== undefined) {
      if (/^https?:\/\//i.test(m[5])) out.push({ k: "a", text: m[4], href: m[5] });
      else out.push({ k: "text", text: m[0] });
    } else out.push({ k: "i", text: m[6] ?? m[7] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ k: "text", text: text.slice(last) });
  return out;
}

// 12, 3.4, $20, 2.9%, 131K, 1.2M, ~40, <1%, 0.30 USD, 250ms: a value a person would line up on its right edge
const NUMBERY = /^[~≈<>+\-−]?\s*[$€£¥]?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|[kKmMbB]|x|ms|s|px|usd|eur|gbp|USD|EUR|GBP|days?|hours?|min)?$/;

/** Pure. Whether every filled cell of column `k` is a number (with a unit or sign), so the column can be lined up on the right. Needs at least two cells to decide. */
export function numericColumn(rows: readonly string[][], k: number): boolean {
  const filled = rows.map((r) => (r[k] ?? "").trim()).filter(Boolean);
  return filled.length >= 2 && filled.every((c) => NUMBERY.test(c));
}
