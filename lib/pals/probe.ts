import type { PromiseRunLog } from "./measure";

/** Structure-only checks that every rail can be asked the same way (O17: never milliseconds, fees or approval rates). */
export const CHECKS = ["typed_error", "idempotent_retry", "server_charge", "refund_read_back"] as const;
export type Check = (typeof CHECKS)[number];
export type ProbeRail = "paypal" | "stripe" | "square";
export type Outcome = "pass" | "fail" | "not_measurable";
export interface ProbeRow {
  rail: ProbeRail;
  check: Check;
  outcome: Outcome;
  detail: string;
}
export const CHECK_LABEL: Record<Check, string> = {
  typed_error: "a bad request returns a machine-readable error code",
  idempotent_retry: "retrying with the same key returns the same object",
  server_charge: "a server alone can complete a charge (no buyer step)",
  refund_read_back: "a refund can be created and read back",
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Pure. Stripe: {"error":{"type","code","param","message"}}. Typed = a type plus at least a code or the offending param. */
export function stripeTypedError(body: unknown): { typed: boolean; detail: string } {
  const e = obj(obj(body)?.error);
  if (!e) return { typed: false, detail: "no error object in the response" };
  const type = str(e.type);
  const code = str(e.code);
  const param = str(e.param);
  return type && (code || param) ? { typed: true, detail: `type ${type}${code ? `, code ${code}` : ""}${param ? `, param ${param}` : ""}` } : { typed: false, detail: "error had no code or param" };
}
/** Pure. Square: {"errors":[{"category","code","detail","field"}]}. */
export function squareTypedError(body: unknown): { typed: boolean; detail: string } {
  const first = obj(Array.isArray(obj(body)?.errors) ? (obj(body)!.errors as unknown[])[0] : null);
  if (!first) return { typed: false, detail: "no errors array in the response" };
  const code = str(first.code);
  const category = str(first.category);
  return code && category ? { typed: true, detail: `category ${category}, code ${code}${str(first.field) ? `, field ${first.field}` : ""}` } : { typed: false, detail: "error had no category or code" };
}
/** Pure. PayPal: {"name","details":[{"issue"}]} (or a name alone for a missing resource). */
export function paypalTypedError(body: unknown): { typed: boolean; detail: string } {
  const b = obj(body);
  const name = str(b?.name);
  const d = obj(Array.isArray(b?.details) ? (b!.details as unknown[])[0] : null);
  const issue = str(d?.issue);
  return name && (issue || str(b?.message)) ? { typed: true, detail: `name ${name}${issue ? `, issue ${issue}` : ""}` } : { typed: false, detail: "error had no name or issue" };
}

/** Pure. {id, status} from a Stripe object or a Square payment/refund wrapper. */
export function stripeObject(body: unknown): { id: string; status: string } | null {
  const b = obj(body);
  const id = str(b?.id);
  const status = str(b?.status);
  return id && status ? { id, status } : null;
}
export function squareObject(body: unknown, key: "payment" | "refund"): { id: string; status: string } | null {
  const o = obj(obj(body)?.[key]);
  const id = str(o?.id);
  const status = str(o?.status);
  return id && status ? { id, status } : null;
}

const row = (rail: ProbeRail, check: Check, outcome: Outcome, detail: string): ProbeRow => ({ rail, check, outcome, detail });
const nm = (rail: ProbeRail, check: Check, why: string): ProbeRow => row(rail, check, "not_measurable", why);

/** What a probe observed, as plain facts. The three `*Rows` functions below turn them into rows. */
export interface StripeObs {
  error?: { status: number; body: unknown };
  first?: { status: number; body: unknown };
  replay?: { status: number; body: unknown };
  refund?: { status: number; body: unknown };
  refundRead?: { status: number; body: unknown };
}
export function stripeRows(o: StripeObs): ProbeRow[] {
  const out: ProbeRow[] = [];
  if (!o.error) out.push(nm("stripe", "typed_error", "the probe did not run"));
  else {
    const t = stripeTypedError(o.error.body);
    out.push(row("stripe", "typed_error", o.error.status >= 400 && t.typed ? "pass" : "fail", `HTTP ${o.error.status}: ${t.detail}`));
  }
  const a = o.first ? stripeObject(o.first.body) : null;
  out.push(!o.first ? nm("stripe", "server_charge", "the probe did not run") : row("stripe", "server_charge", a?.status === "succeeded" ? "pass" : "fail", a ? `PaymentIntent ${a.id} is ${a.status}` : `HTTP ${o.first.status}, no PaymentIntent returned`));
  const b = o.replay ? stripeObject(o.replay.body) : null;
  out.push(!o.replay ? nm("stripe", "idempotent_retry", "needs the first charge to succeed") : row("stripe", "idempotent_retry", a && b && a.id === b.id ? "pass" : "fail", a && b ? (a.id === b.id ? "same id returned on retry" : "retry created a different object") : `HTTP ${o.replay.status}`));
  const r = o.refund ? stripeObject(o.refund.body) : null;
  const rr = o.refundRead ? stripeObject(o.refundRead.body) : null;
  out.push(!o.refund ? nm("stripe", "refund_read_back", "needs the first charge to succeed") : row("stripe", "refund_read_back", r && rr && r.id === rr.id && ["succeeded", "pending"].includes(rr.status) ? "pass" : "fail", rr ? `refund ${rr.id} reads back as ${rr.status}` : `HTTP ${o.refund.status}${o.refundRead ? `/${o.refundRead.status}` : ""}, no readable refund`));
  return out;
}

export type SquareObs = StripeObs;
export function squareRows(o: SquareObs): ProbeRow[] {
  const out: ProbeRow[] = [];
  if (!o.error) out.push(nm("square", "typed_error", "the probe did not run"));
  else {
    const t = squareTypedError(o.error.body);
    out.push(row("square", "typed_error", o.error.status >= 400 && t.typed ? "pass" : "fail", `HTTP ${o.error.status}: ${t.detail}`));
  }
  const a = o.first ? squareObject(o.first.body, "payment") : null;
  out.push(!o.first ? nm("square", "server_charge", "the probe did not run") : row("square", "server_charge", a && ["COMPLETED", "APPROVED"].includes(a.status) ? "pass" : "fail", a ? `payment ${a.id} is ${a.status}` : `HTTP ${o.first.status}, no payment returned`));
  const b = o.replay ? squareObject(o.replay.body, "payment") : null;
  out.push(!o.replay ? nm("square", "idempotent_retry", "needs the first charge to succeed") : row("square", "idempotent_retry", a && b && a.id === b.id ? "pass" : "fail", a && b ? (a.id === b.id ? "same id returned on retry" : "retry created a different payment") : `HTTP ${o.replay.status}`));
  const r = o.refund ? squareObject(o.refund.body, "refund") : null;
  const rr = o.refundRead ? squareObject(o.refundRead.body, "refund") : null;
  out.push(!o.refund ? nm("square", "refund_read_back", "needs the first charge to succeed") : row("square", "refund_read_back", r && rr && r.id === rr.id && ["PENDING", "COMPLETED"].includes(rr.status) ? "pass" : "fail", rr ? `refund ${rr.id} reads back as ${rr.status}` : `HTTP ${o.refund.status}${o.refundRead ? `/${o.refundRead.status}` : ""}, no readable refund`));
  return out;
}

/**
 * PayPal side. The agent holds no PayPal write tool, so only what a read can show is measured here: a typed error from a read of a
 * missing order, and what the last REAL Standing Promise run did. Everything else says exactly why it was not measured.
 */
export function paypalRows(missingOrder: { status: number; body: unknown } | null, run: PromiseRunLog | null): ProbeRow[] {
  const t = missingOrder ? paypalTypedError(missingOrder.body) : null;
  return [
    !missingOrder ? nm("paypal", "typed_error", "the read-only probe did not run") : row("paypal", "typed_error", missingOrder.status >= 400 && t?.typed ? "pass" : "fail", `HTTP ${missingOrder.status}: ${t?.detail}`),
    nm("paypal", "idempotent_retry", "needs an order write; the agent has no PayPal write tool (PayPal-Request-Id is applied by the promise path)"),
    !run ? nm("paypal", "server_charge", "no real promise run in this session yet") : run.settled ? row("paypal", "server_charge", run.approved ? "fail" : "pass", run.approved ? "capture ran server-side, but only after the buyer approved on PayPal (one human step before capture)" : "capture ran with no buyer approval") : nm("paypal", "server_charge", `the last run ended ${run.state}`),
    !run ? nm("paypal", "refund_read_back", "no real promise run in this session yet") : run.state === "released" ? row("paypal", "refund_read_back", run.orderStatusAfter !== null && run.orderStatusAfter !== "COMPLETED" ? "pass" : "fail", `release read back: order ${run.orderStatusAfter ?? "unreadable"} (nothing captured)`) : nm("paypal", "refund_read_back", "the last run captured; the refund route was not exercised"),
  ];
}
