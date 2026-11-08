/**
 * Every vendor returns an AdapterResult. A vendor failure is NEVER an exception at the call site:
 * it is a degraded result the caller renders (a dim trace row) and works around.
 */
export type AdapterResult<T> = { ok: true; data: T } | { ok: false; degraded: true; reason: string };

export interface ProductFact {
  productId: string;
  title: string;
  priceMinor: number; // integer minor units (converted from the vendor's JSON number via minorFromJson)
  currency: string;
  inStock: boolean;
  merchant: string;
  buyUrl: string;
}

export interface PageFact {
  url: string;
  text: string; // first 4000 chars of body text
  replayUrl?: string; // KERNEL replay. Evidence only, never compared by the verdict
}

/** One web hit from any search vendor. Evidence for the Ask thread and cited promises; the verdict never reads it. */
export interface WebSource {
  url: string; // http(s) only
  title: string;
  snippet: string; // vendor-provided excerpt, trimmed by the research pipeline before it reaches a model
  publishedDate: string | null;
  provider: "tavily" | "exa";
  score: number | null; // vendor relevance, only comparable within one provider
}

export interface NudgeInput {
  promiseId: string;
  payerName: string;
  payerEmail: string;
  amountLabel: string; // e.g. "10.50 USD", built with formatMajor. Never use toFixed
  daysLate: number;
}
