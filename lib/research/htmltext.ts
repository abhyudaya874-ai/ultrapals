const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const BLOCK = /<\/?(?:p|div|br|hr|h[1-6]|li|ul|ol|tr|table|section|article|header|footer|main|nav|blockquote|pre)\b[^>]*>/gi;

/**
 * Pure. Visible text of an HTML page, roughly what a person reads: scripts, styles, comments and tags are gone, block elements break
 * lines, entities are decoded. It cannot know CSS (display:none text stays in). Non-HTML input (JSON, markdown) passes through trimmed.
 */
export function htmlToText(html: string): string {
  if (!/<(?:html|body|div|p|h1|article|section|span|a)\b/i.test(html)) return html.replace(/\r/g, "").trim();
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => ENT[e] ?? e)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
