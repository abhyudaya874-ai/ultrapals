import { z } from "zod";
import { canonicalUrl, hostOf } from "@/lib/research/sources";

export const ARCHETYPES = ["counterparty", "latency", "friction", "evidence", "cost", "corridor", "identity", "reversal"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const PAYPAL_CAPS = ["Vault", "AuthCapture", "Void", "Refund", "Disputes", "PayLater", "Payouts", "FeeSchedule", "Webhooks", "ExpandedCheckout"] as const;
export type PayPalCap = (typeof PAYPAL_CAPS)[number];

export const MUTATIONS = [
  "placeholder_asset", "relist_new_id", "payee_swap", "cloaked_page", "duplicate_callback", "stale_cache",
  "timeout", "currency_drift", "partial_delivery", "prompt_injection", "policy_edit", "contradictory_observers",
] as const;
export type Mutation = (typeof MUTATIONS)[number];

export const MAX_RIVALS = 6;
const STALE_MS = 18 * 30 * 86_400_000;
const PAYPAL_DOC_HOST = "developer.paypal.com";

const RivalSource = z.object({
  url: z.string().url(),
  operator: z.enum(["tavily", "exa"]),
  fetchedAtMs: z.number().int().positive(),
  quote: z.string().trim().min(8).max(200),
});

/** A rival is an examiner: a real-world failure class, a runnable attack, a closed-enum PayPal counter, and cited sources. */
export const Rival = z.object({
  archetype: z.enum(ARCHETYPES),
  thesisOwner: z.string().trim().min(2).max(40),
  failureClass: z.string().trim().min(3).max(80),
  attack: z.enum(MUTATIONS),
  counter: z.object({ capability: z.enum(PAYPAL_CAPS), docUrl: z.string().url() }),
  sources: z.array(RivalSource).min(1).max(4),
});
export type Rival = z.infer<typeof Rival>;

/** What the FETCHER saw. The model never writes these fields; `fetchedAtMs` here is the only trusted timestamp. */
export interface FetchedPage {
  url: string;
  text: string;
  fetchedAtMs: number;
  publishedMs?: number;
  operator?: "tavily" | "exa";
}

export type RivalCheck = { ok: true; domains: number; stale: boolean } | { ok: false; errors: string[] };

const squash = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Pure. Cite-or-die: every source must match a page the fetcher actually fetched, the quote must be a substring of
 * that page, the timestamp must be the fetcher's, the thesis owner must appear in the evidence, and the PayPal counter
 * must point at PayPal's own docs. Never throws.
 */
export function verifyRival(input: unknown, fetched: FetchedPage[], nowMs: number): RivalCheck {
  const p = Rival.safeParse(input);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => `${i.path.join(".") || "rival"}: ${i.message}`) };
  const r = p.data;
  const errors: string[] = [];
  const byUrl = new Map(fetched.map((f) => [canonicalUrl(f.url), f]));
  const hosts = new Set<string>();
  let stale = false;
  let ownerSeen = false;
  const owner = squash(r.thesisOwner);

  r.sources.forEach((s, i) => {
    const page = byUrl.get(canonicalUrl(s.url));
    if (!page) return void errors.push(`sources.${i}: ${s.url} was never fetched`);
    if (s.fetchedAtMs !== page.fetchedAtMs) errors.push(`sources.${i}: fetchedAtMs is not the fetcher's stamp`);
    if (page.fetchedAtMs > nowMs) errors.push(`sources.${i}: fetched in the future`);
    if (page.operator && page.operator !== s.operator) errors.push(`sources.${i}: operator is ${s.operator} but ${page.operator} fetched it`);
    if (!squash(page.text).includes(squash(s.quote))) errors.push(`sources.${i}: quote is not in the fetched text`);
    hosts.add(hostOf(s.url));
    if (page.publishedMs !== undefined && nowMs - page.publishedMs > STALE_MS) stale = true;
    if (squash(page.text).includes(owner) || hostOf(s.url).includes(owner.replace(/\s+/g, ""))) ownerSeen = true;
  });
  if (!ownerSeen && errors.length === 0) errors.push(`thesisOwner "${r.thesisOwner}" appears in no source`);

  const doc = new URL(r.counter.docUrl);
  if (doc.protocol !== "https:" || doc.hostname !== PAYPAL_DOC_HOST) errors.push(`counter.docUrl must be https://${PAYPAL_DOC_HOST}/...`);

  return errors.length ? { ok: false, errors } : { ok: true, domains: hosts.size, stale };
}

const normClass = (s: string): string => squash(s).replace(/[^a-z0-9 ]/g, "");

/** Pure. Similarity kill on (archetype, failure class) or on a shared source domain within an archetype; first wins; capped. */
export function dedupeRivals(rivals: Rival[], max = MAX_RIVALS): Rival[] {
  const kept: Rival[] = [];
  for (const r of rivals) {
    if (kept.length >= max) break;
    const hosts = new Set(r.sources.map((s) => hostOf(s.url)));
    const clash = kept.some(
      (k) => k.archetype === r.archetype && (normClass(k.failureClass) === normClass(r.failureClass) || k.sources.some((s) => hosts.has(hostOf(s.url)))),
    );
    if (!clash) kept.push(r);
  }
  return kept;
}
