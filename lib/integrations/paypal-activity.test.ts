import { describe, expect, it } from "vitest";
import { normalizeBalances, normalizeInvoice, normalizeTransaction, transactionWindow, TRANSACTION_SEARCH_MAX_DAYS } from "./paypal-activity";

// Fixture shapes follow the PayPal sandbox REST reference (invoicing v2, reporting v1).
const invoice = {
  id: "INV2-ABC123",
  status: "UNPAID",
  detail: {
    invoice_number: "0001",
    currency_code: "USD",
    invoice_date: "2026-11-01T10:00:00Z",
    payment_term: { term_type: "DUE_ON_RECEIPT", due_date: "2026-11-15T00:00:00Z" },
  },
  amount: { value: "42.50", currency_code: "USD" },
  due_amount: { value: "42.50", currency_code: "USD" },
  primary_recipients: [{ billing_info: { name: { full_name: "Ada Lovelace" }, email_address: "ada@example.com" } }],
};

const transaction = {
  transaction_info: {
    transaction_id: "5AL123456789",
    transaction_initiation_date: "2026-11-08T08:00:00Z",
    transaction_amount: { value: "10.00", currency_code: "USD" },
    transaction_status: "S",
    transaction_note: "Capture for order",
  },
};

describe("normalizeInvoice", () => {
  it("maps an unpaid invoice to a row with integer minor units", () => {
    expect(normalizeInvoice(invoice)).toMatchObject({
      type: "invoice", id: "INV2-ABC123", number: "0001", status: "UNPAID",
      customer: "Ada Lovelace", amountMinor: 4250, currency: "USD",
      issuedAt: "2026-11-01T10:00:00Z", dueAt: "2026-11-15T00:00:00Z",
    });
  });
  it("prefers due_amount over amount", () => {
    const partial = { ...invoice, due_amount: { value: "12.00", currency_code: "USD" } };
    expect(normalizeInvoice(partial)?.amountMinor).toBe(1200);
  });
  it("falls back to business name then email for the customer", () => {
    const biz = { ...invoice, primary_recipients: [{ billing_info: { business_name: "Analytical Engines Inc" } }] };
    expect(normalizeInvoice(biz)?.customer).toBe("Analytical Engines Inc");
    const mail = { ...invoice, primary_recipients: [{ billing_info: { email_address: "ops@example.com" } }] };
    expect(normalizeInvoice(mail)?.customer).toBe("ops@example.com");
  });
  it("returns null when there is no usable amount", () => {
    expect(normalizeInvoice({ ...invoice, amount: undefined, due_amount: undefined })).toBeNull();
    expect(normalizeInvoice({ ...invoice, due_amount: { value: "abc", currency_code: "USD" } })).toBeNull();
  });
  it("returns null for junk", () => {
    expect(normalizeInvoice(null)).toBeNull();
    expect(normalizeInvoice({})).toBeNull();
  });
});

describe("normalizeTransaction", () => {
  it("maps a capture transaction to a row", () => {
    expect(normalizeTransaction(transaction)).toMatchObject({
      type: "transaction", id: "5AL123456789", date: "2026-11-08T08:00:00Z",
      amountMinor: 1000, currency: "USD", status: "S", note: "Capture for order",
    });
  });
  it("keeps negative amounts as negative minor units (refunds)", () => {
    const refund = { transaction_info: { ...transaction.transaction_info, transaction_amount: { value: "-10.00", currency_code: "USD" } } };
    expect(normalizeTransaction(refund)?.amountMinor).toBe(-1000);
  });
  it("returns null without an amount or id", () => {
    expect(normalizeTransaction({ transaction_info: { transaction_id: "x" } })).toBeNull();
    expect(normalizeTransaction({ transaction_info: { transaction_amount: { value: "1.00", currency_code: "USD" } } })).toBeNull();
  });
});

describe("normalizeBalances", () => {
  it("maps each currency balance to integer minor units", () => {
    const rows = normalizeBalances({
      balances: [
        { currency: "USD", total_balance: { value: "123.45", currency_code: "USD" }, available_balance: { value: "100.00", currency_code: "USD" } },
        { currency: "EUR", total_balance: { value: "50.00", currency_code: "EUR" }, available_balance: { value: "50.00", currency_code: "EUR" } },
      ],
    });
    expect(rows).toEqual([
      { type: "balance", id: "bal-USD", customer: "", amountMinor: null, currency: "USD", status: "", dueAt: null, totalMinor: 12345, availableMinor: 10000 },
      { type: "balance", id: "bal-EUR", customer: "", amountMinor: null, currency: "EUR", status: "", dueAt: null, totalMinor: 5000, availableMinor: 5000 },
    ]);
  });
  it("skips balances with unparseable money and returns [] for junk", () => {
    expect(normalizeBalances({ balances: [{ currency: "USD" }] })).toEqual([]);
    expect(normalizeBalances(null)).toEqual([]);
    expect(normalizeBalances({})).toEqual([]);
  });
});

describe("uniform row keys", () => {
  // Studio infers the source schema from row keys: a missing key shows as "Invalid field" in the mapping panel.
  const KEYS = ["customer", "amountMinor", "currency", "status", "dueAt"] as const;
  it("every row type carries the five widget-mapped fields", () => {
    const rows = [
      normalizeInvoice(invoice),
      normalizeTransaction(transaction),
      ...normalizeBalances({ balances: [{ currency: "USD", total_balance: { value: "1.00", currency_code: "USD" }, available_balance: { value: "1.00", currency_code: "USD" } }] }),
    ].filter(Boolean);
    for (const row of rows) for (const k of KEYS) expect(row).toHaveProperty(k);
  });
});

describe("transactionWindow", () => {
  it("stays inside the 31-day search limit and drops fractional seconds", () => {
    const w = transactionWindow(new Date("2026-11-08T08:39:51.921Z"));
    expect(w.end).toBe("2026-11-08T08:39:51Z");
    expect(w.start).toBe("2026-10-09T08:39:51Z"); // 30 days back
    const days = (Date.parse(w.end) - Date.parse(w.start)) / 86_400_000;
    expect(days).toBeLessThan(TRANSACTION_SEARCH_MAX_DAYS);
    expect(w.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(w.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
