import { describe, expect, it } from "vitest";
import { paypalRows, paypalTypedError, squareObject, squareRows, squareTypedError, stripeObject, stripeRows, stripeTypedError } from "./probe";

const ok = (body: unknown) => ({ status: 200, body });
describe("typed errors", () => {
  it("stripe: type plus code or param", () => {
    expect(stripeTypedError({ error: { type: "invalid_request_error", code: "parameter_invalid_integer", param: "amount" } }).typed).toBe(true);
    expect(stripeTypedError({ error: { type: "invalid_request_error" } }).typed).toBe(false);
    expect(stripeTypedError("<html>502</html>").typed).toBe(false);
  });
  it("square: category and code", () => {
    expect(squareTypedError({ errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE", field: "amount_money" }] }).typed).toBe(true);
    expect(squareTypedError({ errors: [] }).typed).toBe(false);
  });
  it("paypal: name plus issue or message", () => {
    expect(paypalTypedError({ name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] }).typed).toBe(true);
    expect(paypalTypedError({ name: "X", message: "m" }).typed).toBe(true);
    expect(paypalTypedError({ foo: 1 }).typed).toBe(false);
  });
  it("object readers", () => {
    expect(stripeObject({ id: "pi_1", status: "succeeded" })).toEqual({ id: "pi_1", status: "succeeded" });
    expect(stripeObject({ id: "pi_1" })).toBeNull();
    expect(squareObject({ payment: { id: "p", status: "COMPLETED" } }, "payment")).toEqual({ id: "p", status: "COMPLETED" });
    expect(squareObject({ refund: {} }, "refund")).toBeNull();
  });
});

describe("stripeRows", () => {
  const good = { error: { status: 400, body: { error: { type: "invalid_request_error", code: "x", param: "amount" } } }, first: ok({ id: "pi_1", status: "succeeded" }), replay: ok({ id: "pi_1", status: "succeeded" }), refund: ok({ id: "re_1", status: "succeeded" }), refundRead: ok({ id: "re_1", status: "succeeded" }) };
  it("all four pass on a clean run", () => expect(stripeRows(good).map((r) => r.outcome)).toEqual(["pass", "pass", "pass", "pass"]));
  it("a retry that made a new object fails idempotency", () => {
    expect(stripeRows({ ...good, replay: ok({ id: "pi_2", status: "succeeded" }) }).find((r) => r.check === "idempotent_retry")?.outcome).toBe("fail");
  });
  it("a charge that did not succeed fails and is never a pass", () => {
    const r = stripeRows({ ...good, first: { status: 402, body: { error: { type: "card_error" } } }, replay: undefined, refund: undefined, refundRead: undefined });
    expect(r.find((x) => x.check === "server_charge")?.outcome).toBe("fail");
    expect(r.find((x) => x.check === "idempotent_retry")?.outcome).toBe("not_measurable");
    expect(r.find((x) => x.check === "refund_read_back")?.outcome).toBe("not_measurable");
  });
  it("nothing observed is not_measurable on every row", () => expect(stripeRows({}).every((r) => r.outcome === "not_measurable")).toBe(true));
});

describe("squareRows", () => {
  const good = { error: { status: 400, body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_VALUE" }] } }, first: ok({ payment: { id: "p1", status: "COMPLETED" } }), replay: ok({ payment: { id: "p1", status: "COMPLETED" } }), refund: ok({ refund: { id: "r1", status: "PENDING" } }), refundRead: ok({ refund: { id: "r1", status: "COMPLETED" } }) };
  it("all four pass on a clean run", () => expect(squareRows(good).map((r) => r.outcome)).toEqual(["pass", "pass", "pass", "pass"]));
  it("a refund that reads back FAILED is a fail", () => {
    expect(squareRows({ ...good, refundRead: ok({ refund: { id: "r1", status: "FAILED" } }) }).find((r) => r.check === "refund_read_back")?.outcome).toBe("fail");
  });
});

describe("paypalRows (read-only: no PayPal write tool)", () => {
  const run = (o: object = {}) => ({ promiseId: "p", approved: true, settled: true, state: "captured", orderStatusAfter: "COMPLETED", moneyOpsCarriedId: true, currency: "USD", ...o });
  it("measures the typed error from a read, and says why idempotency is not measured", () => {
    const r = paypalRows({ status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } }, null);
    expect(r[0].outcome).toBe("pass");
    expect(r[1].outcome).toBe("not_measurable");
    expect(r[1].detail).toContain("no PayPal write tool");
  });
  it("without a real run, charge and refund are not measurable (never a pass)", () => {
    expect(paypalRows(null, null).slice(2).every((r) => r.outcome === "not_measurable")).toBe(true);
  });
  it("a captured run records the buyer-approval step as a fail on server_charge: an honest structural cost", () => {
    const r = paypalRows(null, run());
    expect(r[2]).toMatchObject({ check: "server_charge", outcome: "fail" });
    expect(r[2].detail).toContain("buyer approved");
  });
  it("a released run reads back as not captured", () => {
    expect(paypalRows(null, run({ state: "released", orderStatusAfter: "APPROVED", settled: true }))[3].outcome).toBe("pass");
    expect(paypalRows(null, run({ state: "released", orderStatusAfter: "COMPLETED" }))[3].outcome).toBe("fail");
  });
});
