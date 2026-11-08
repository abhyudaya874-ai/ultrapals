import { ARTICLES } from "@/lib/newsroom";

/** Pure. Extracts `article=<slug>` from OUR proof URL shape; null when the path or param is absent/malformed. */
export function articleFromProofUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname !== "/api/newsroom/proof") return null;
    return u.searchParams.get("article");
  } catch {
    return null;
  }
}

export interface PromiseAccessRow {
  state: string;
  condition: { kind?: string; url?: string; needle?: string } | null;
}

/** Pure. A premium article unlocks only for a CAPTURED promise whose condition proves THIS article (proof URL + needle). */
export function isUnlockedFor(row: PromiseAccessRow | null | undefined, slug: string): boolean {
  if (!row || row.state !== "captured") return false;
  const c = row.condition;
  return c?.kind === "page_contains" && typeof c.url === "string" && articleFromProofUrl(c.url) === slug && c.needle === `unlocked:${slug}`;
}
