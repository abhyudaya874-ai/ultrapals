/** Pure. A passage trimmed to whole words and a length a card can hold. */
export function excerpt(text: string, max = 230): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max);
  return `${t.slice(0, cut > max * 0.6 ? cut : max).trimEnd()}…`;
}
