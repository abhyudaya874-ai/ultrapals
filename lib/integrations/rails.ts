import { getEnv } from "@/lib/env";
import { call } from "@/lib/paypal";
import { paypalRows, squareRows, stripeRows, type ProbeRow, type SquareObs, type StripeObs } from "@/lib/pals/probe";
import type { PromiseRunLog } from "@/lib/pals/measure";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";

const STRIPE = "https://api.stripe.com/v1";
const SQUARE = "https://connect.squareupsandbox.com/v2"; // sandbox host only. A production host here is a bug.
const TIMEOUT_MS = 12_000;
type Reply = { status: number; body: unknown };

async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Reply> {
  const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])];
  const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const form = (o: Record<string, string>): string => new URLSearchParams(o).toString();

/**
 * Stripe TEST mode, with the owner's test key (sk_test_ only; the capability is off for any other prefix). One charge with the
 * documented test PaymentMethod pm_card_visa, the same request replayed under the same Idempotency-Key, a refund, its read-back, and a
 * deliberately invalid request. Test data only; nothing here can move real money.
 */
export async function probeStripe(runId: string, signal?: AbortSignal): Promise<AdapterResult<ProbeRow[]>> {
  if (!isOn("stripe")) return degrade("stripe off");
  return guard("stripe", async () => {
    const key = getEnv().STRIPE_SANDBOX_KEY ?? "";
    if (!key.startsWith("sk_test_")) return degrade("stripe: only sk_test_ keys are accepted");
    const auth = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" };
    const charge = form({ amount: "500", currency: "usd", payment_method: "pm_card_visa", confirm: "true", "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never" });
    const obs: StripeObs = {};
    obs.error = await send(`${STRIPE}/payment_intents`, { method: "POST", headers: auth, body: form({ amount: "-5", currency: "usd" }) }, signal);
    obs.first = await send(`${STRIPE}/payment_intents`, { method: "POST", headers: { ...auth, "Idempotency-Key": `sp-${runId}-pi` }, body: charge }, signal);
    const pi = (obs.first.body as { id?: unknown } | null)?.id;
    if (obs.first.status === 200 && typeof pi === "string") {
      obs.replay = await send(`${STRIPE}/payment_intents`, { method: "POST", headers: { ...auth, "Idempotency-Key": `sp-${runId}-pi` }, body: charge }, signal);
      obs.refund = await send(`${STRIPE}/refunds`, { method: "POST", headers: { ...auth, "Idempotency-Key": `sp-${runId}-re` }, body: form({ payment_intent: pi }) }, signal);
      const re = (obs.refund.body as { id?: unknown } | null)?.id;
      if (typeof re === "string") obs.refundRead = await send(`${STRIPE}/refunds/${encodeURIComponent(re)}`, { method: "GET", headers: auth }, signal);
    }
    return { ok: true, data: stripeRows(obs) };
  });
}

/** Square SANDBOX with the owner's sandbox access token and the documented test source cnon:card-nonce-ok. Same five steps as Stripe. */
export async function probeSquare(runId: string, signal?: AbortSignal): Promise<AdapterResult<ProbeRow[]>> {
  if (!isOn("square")) return degrade("square off");
  return guard("square", async () => {
    const h = { Authorization: `Bearer ${getEnv().SQUARE_SANDBOX_KEY ?? ""}`, "Content-Type": "application/json", Accept: "application/json" };
    const pay = (key: string, amount: number) => JSON.stringify({ source_id: "cnon:card-nonce-ok", idempotency_key: key, amount_money: { amount, currency: "USD" }, autocomplete: true });
    const obs: SquareObs = {};
    obs.error = await send(`${SQUARE}/payments`, { method: "POST", headers: h, body: pay(`sp-${runId}-bad`, -5) }, signal);
    obs.first = await send(`${SQUARE}/payments`, { method: "POST", headers: h, body: pay(`sp-${runId}-pay`, 500) }, signal);
    const id = (obs.first.body as { payment?: { id?: unknown } } | null)?.payment?.id;
    if (obs.first.status === 200 && typeof id === "string") {
      obs.replay = await send(`${SQUARE}/payments`, { method: "POST", headers: h, body: pay(`sp-${runId}-pay`, 500) }, signal);
      obs.refund = await send(`${SQUARE}/refunds`, { method: "POST", headers: h, body: JSON.stringify({ idempotency_key: `sp-${runId}-ref`, payment_id: id, amount_money: { amount: 500, currency: "USD" } }) }, signal);
      const rid = (obs.refund.body as { refund?: { id?: unknown } } | null)?.refund?.id;
      if (typeof rid === "string") obs.refundRead = await send(`${SQUARE}/refunds/${encodeURIComponent(rid)}`, { method: "GET", headers: h }, signal);
    }
    return { ok: true, data: squareRows(obs) };
  });
}

/** PayPal sandbox, READ-ONLY: a GET of an order id that cannot exist (typed error), plus what the last real promise run did. Writes nothing. */
export async function probePayPal(run: PromiseRunLog | null, signal?: AbortSignal): Promise<AdapterResult<ProbeRow[]>> {
  return guard("studio", async () => {
    let missing: Reply | null = null;
    try {
      missing = await call("GET", "/v2/checkout/orders/SITUATIONPALNOSUCHORDER", { signal: signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      missing = null;
    }
    return { ok: true, data: paypalRows(missing, run) };
  });
}
