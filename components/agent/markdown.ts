export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "code"; lang: string; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "quote"; text: string }
  | { t: "hr" };

const cells = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Pure. A small, safe markdown subset (headings, lists, fenced code, tables, quotes, rules, paragraphs) as blocks. Nothing here produces HTML. */
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
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: q.join("\n") });
      continue;
    }
    const ul = /^\s*[-*+]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const re = ul.test(line) ? ul : ol;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      out.push({ t: re === ul ? "ul" : "ol", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*```|#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isSep(lines[i + 1]))) para.push(lines[i++]);
    if (para.length === 0) { para.push(lines[i++]); } // a line that matched no rule still advances
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

export type Inline = { k: "text"; text: string } | { k: "b"; text: string } | { k: "code"; text: string } | { k: "a"; text: string; href: string };

/** Pure. **bold**, `code` and a markdown link only when it points at a web address; anything else stays plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ k: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ k: "b", text: m[1] });
    else if (m[2] !== undefined) out.push({ k: "code", text: m[2] });
    else if (/^https?:\/\//i.test(m[4])) out.push({ k: "a", text: m[3], href: m[4] });
    else out.push({ k: "text", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ k: "text", text: text.slice(last) });
  return out;
}
