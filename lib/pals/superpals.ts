import type { Metric, Provenance, RowStatus } from "./ladder";
import type { Evidence } from "./evidence";
import type { PayPalCap } from "./rival";

/**
 * The SuperPals: PayPal's rivals as seeded examiners (D-RIVAL realised with Pal naming). The roster is FROZEN per
 * release so scores stay comparable across runs; the bars are analyst-set, never model-written, and every row is
 * structure-only (O17). A SuperPal row is reported on the receipt; it NEVER gates the seal.
 */
export interface SuperPal {
  id: string;
  name: string;
  company: string;
  edge: string; // what they are measurably better at, one line
  metric: Metric;
  op: "<=" | ">=";
  value: number;
  provenance: Provenance;
  counter: { capability: PayPalCap; docUrl: string };
  keyEnv: string; // the sandbox key that turns the row on (provided later)
  needsKey: boolean; // false when the run log alone can measure it
}

export const SUPER_PALS: readonly SuperPal[] = [
  { id: "stripe", name: "StripePal", company: "Stripe", edge: "developer experience: typed errors, test clocks, no dashboard detours", metric: "typed_error_coverage", op: ">=", value: 1, provenance: "analyst", counter: { capability: "FeeSchedule", docUrl: "https://developer.paypal.com/api/errors/overview/" }, keyEnv: "STRIPE_SANDBOX_KEY", needsKey: true },
  { id: "shopify", name: "ShopifyPal", company: "Shopify", edge: "the offer is machine-readable where agents already shop", metric: "machine_readable_offer", op: ">=", value: 1, provenance: "analyst", counter: { capability: "ExpandedCheckout", docUrl: "https://developer.paypal.com/agent-ready/overview/" }, keyEnv: "SHOPIFY_SANDBOX_KEY", needsKey: true },
  { id: "apple", name: "ApplePal", company: "Apple Pay", edge: "one tap, biometric, no forms", metric: "buyer_steps", op: "<=", value: 1, provenance: "analyst", counter: { capability: "Vault", docUrl: "https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture/" }, keyEnv: "APPLE_SANDBOX_KEY", needsKey: true },
  { id: "adyen", name: "AdyenPal", company: "Adyen", edge: "routes across rails instead of committing to one", metric: "rail_routing_present", op: ">=", value: 1, provenance: "analyst", counter: { capability: "PayLater", docUrl: "https://developer.paypal.com/api/nvp-soap/paypal-payments-pro/integration-guide/authorizations/" }, keyEnv: "ADYEN_SANDBOX_KEY", needsKey: true },
  { id: "wise", name: "WisePal", company: "Wise", edge: "a quoted FX truth before the commit", metric: "fx_quote_present", op: ">=", value: 1, provenance: "analyst", counter: { capability: "Payouts", docUrl: "https://developer.paypal.com/payouts/currency-conversion/" }, keyEnv: "WISE_SANDBOX_KEY", needsKey: true },
  { id: "klarna", name: "KlarnaPal", company: "Klarna", edge: "defer and soften the price at checkout", metric: "deferral_present", op: ">=", value: 1, provenance: "analyst", counter: { capability: "PayLater", docUrl: "https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture/" }, keyEnv: "KLARNA_SANDBOX_KEY", needsKey: true },
  { id: "x402", name: "X402Pal", company: "Coinbase x402", edge: "machine-native capture with no human in the loop", metric: "human_steps_at_capture", op: "<=", value: 0, provenance: "measured", counter: { capability: "Vault", docUrl: "https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture/" }, keyEnv: "COINBASE_SANDBOX_KEY", needsKey: false },
  { id: "square", name: "SquarePal", company: "Square", edge: "sellers reachable inside ChatGPT and Claude", metric: "assistant_ordering_present", op: ">=", value: 1, provenance: "analyst", counter: { capability: "Webhooks", docUrl: "https://developer.paypal.com/api/rest/webhooks/" }, keyEnv: "SQUARE_SANDBOX_KEY", needsKey: true },
];

const cmp = (op: "<=" | ">=", a: number, b: number): boolean => (op === "<=" ? a <= b : a >= b);

export interface SuperPalRow {
  pal: SuperPal;
  observed: number | null;
  status: RowStatus;
  note?: string;
  /** A cited line about this rival, found by its own ResearchPal. Context only: it never changes the status. */
  evidence?: Evidence;
}

export interface SuperInputs {
  values?: Partial<Record<Metric, number>>;
  keysPresent?: Partial<Record<string, boolean>>;
}

/** Pure. One row per SuperPal. A missing sandbox key is NOT_MEASURABLE with the env key named; it is never a pass. */
export function scoreSuperPals(m: SuperInputs, pals: readonly SuperPal[] = SUPER_PALS): SuperPalRow[] {
  return pals.map((pal) => {
    if (pal.needsKey && !m.keysPresent?.[pal.keyEnv]) return { pal, observed: null, status: "NOT_MEASURABLE", note: `${pal.keyEnv} not provided yet` };
    const observed = m.values?.[pal.metric];
    if (observed === undefined || !Number.isInteger(observed) || observed < 0) return { pal, observed: null, status: "NOT_MEASURABLE", note: "not measured on this run" };
    return { pal, observed, status: cmp(pal.op, observed, pal.value) ? "BAR_MET" : "BAR_MISSED" };
  });
}
