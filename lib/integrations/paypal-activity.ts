import { z } from "zod";
import { minorFromJson } from "@/lib/money";
import { call } from "@/lib/paypal";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";

/**
 * Read-only PayPal "activity" feed for the Studio board: unpaid invoices, recent transactions, balances.
 * Sandbox REST only, through the shared authenticated call(). NEVER feeds computeVerdict — display rows only.
 * Every fetch degrades to [] on its own so one missing scope never blanks the widget.
 */

const Money = z.object({ value: z.union([z.string(), z.number()]), currency_code: z.string() });

const InvoiceRaw = z.object({
  id: z.string(),
  status: z.string().optional(),
  detail: z
    .object({
      invoice_number: z.string().optional(),
      invoice_date: z.string().optional(),
      payment_term: z.object({ due_date: z.string().optional() }).optional(),
    })
    .optional(),
  amount: Money.optional(),
  due_amount: Money.optional(),
  primary_recipients: z
    .array(
      z.object({
        billing_info: z
          .object({
            name: z.object({ full_name: z.string().optional() }).optional(),
            business_name: z.string().optional(),
            email_address: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const TransactionRaw = z.object({
  transaction_info: z.object({
    transaction_id: z.string(),
    transaction_initiation_date: z.string().optional(),
    transaction_amount: Money.optional(),
    transaction_status: z.string().optional(),
    transaction_note: z.string().optional(),
    transaction_subject: z.string().optional(),
  }),
});

const BalancesRaw = z.object({
  balances: z
    .array(
      z.object({
        currency: z.string(),
        total_balance: Money.optional(),
        available_balance: Money.optional(),
      }),
    )
    .optional(),
});

// Studio infers the source schema from row keys: every row carries the five widget-mapped
// fields (customer, amountMinor, currency, status, dueAt), empty when a row type lacks them.
interface ActivityShared {
  customer: string;
  amountMinor: number | null;
  currency: string;
  status: string;
  dueAt: string | null;
}

export interface InvoiceRow extends ActivityShared {
  type: "invoice";
  id: string;
  number: string;
  amountMinor: number;
  issuedAt: string | null;
}

export interface TransactionRow extends ActivityShared {
  type: "transaction";
  id: string;
  date: string | null;
  amountMinor: number;
  note: string;
}

export interface BalanceRow extends ActivityShared {
  type: "balance";
  id: string;
  totalMinor: number;
  availableMinor: number;
}

export type ActivityRow = InvoiceRow | TransactionRow | BalanceRow;

function minor(m: z.infer<typeof Money> | undefined): { minor: number; currency: string } | null {
  if (!m) return null;
  try {
    // Reporting sends "-10.00" for reversals; parseMinor rejects signs, so strip it and re-apply.
    const raw = String(m.value).trim();
    const neg = raw.startsWith("-");
    const n = minorFromJson(neg ? raw.slice(1) : raw, m.currency_code);
    return { minor: neg ? -n : n, currency: m.currency_code };
  } catch {
    return null;
  }
}

export function normalizeInvoice(raw: unknown): InvoiceRow | null {
  const p = InvoiceRaw.safeParse(raw);
  if (!p.success) return null;
  const i = p.data;
  const money = minor(i.due_amount ?? i.amount);
  if (!money) return null;
  const billing = i.primary_recipients?.[0]?.billing_info;
  return {
    type: "invoice",
    id: i.id,
    number: i.detail?.invoice_number ?? i.id,
    status: i.status ?? "UNKNOWN",
    customer: billing?.name?.full_name ?? billing?.business_name ?? billing?.email_address ?? "",
    amountMinor: money.minor,
    currency: money.currency,
    issuedAt: i.detail?.invoice_date ?? null,
    dueAt: i.detail?.payment_term?.due_date ?? null,
  };
}

export function normalizeTransaction(raw: unknown): TransactionRow | null {
  const p = TransactionRaw.safeParse(raw);
  if (!p.success) return null;
  const t = p.data.transaction_info;
  const money = minor(t.transaction_amount);
  if (!money) return null;
  return {
    type: "transaction",
    id: t.transaction_id,
    customer: "",
    date: t.transaction_initiation_date ?? null,
    amountMinor: money.minor,
    currency: money.currency,
    status: t.transaction_status ?? "UNKNOWN",
    dueAt: null,
    note: t.transaction_note ?? t.transaction_subject ?? "",
  };
}

export function normalizeBalances(raw: unknown): BalanceRow[] {
  const p = BalancesRaw.safeParse(raw);
  if (!p.success) return [];
  return (p.data.balances ?? []).flatMap((b) => {
    const total = minor(b.total_balance);
    const available = minor(b.available_balance);
    if (!total || !available) return [];
    return [
      {
        type: "balance" as const,
        id: `bal-${b.currency}`,
        customer: "",
        amountMinor: null,
        currency: b.currency,
        status: "",
        dueAt: null,
        totalMinor: total.minor,
        availableMinor: available.minor,
      },
    ];
  });
}

/** Transaction Search allows at most a 31-day range and rejects fractional seconds. */
export const TRANSACTION_SEARCH_MAX_DAYS = 31;

export function transactionWindow(now: Date = new Date()): { start: string; end: string } {
  const end = new Date(now.getTime());
  end.setUTCMilliseconds(0);
  const start = new Date(end.getTime() - (TRANSACTION_SEARCH_MAX_DAYS - 1) * 86_400_000);
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return { start: iso(start), end: iso(end) };
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const r = await call("GET", path, { signal });
  if (r.status < 200 || r.status >= 300) throw new Error(`paypal ${r.status}`);
  return r.body;
}

async function fetchInvoices(signal?: AbortSignal): Promise<InvoiceRow[]> {
  const body = await getJson("/v2/invoicing/invoices?total_required=true&page_size=50", signal);
  const items = z.object({ items: z.array(z.unknown()).optional() }).parse(body).items ?? [];
  return items.map(normalizeInvoice).filter((r): r is InvoiceRow => r !== null);
}

async function fetchTransactions(signal?: AbortSignal): Promise<TransactionRow[]> {
  const w = transactionWindow();
  const body = await getJson(
    `/v1/reporting/transactions?start_date=${encodeURIComponent(w.start)}&end_date=${encodeURIComponent(w.end)}&fields=all&page_size=100&page=1`,
    signal,
  );
  const items = z.object({ transaction_details: z.array(z.unknown()).optional() }).parse(body).transaction_details ?? [];
  return items.map(normalizeTransaction).filter((r): r is TransactionRow => r !== null);
}

async function fetchBalances(signal?: AbortSignal): Promise<BalanceRow[]> {
  return normalizeBalances(await getJson("/v1/reporting/balances", signal));
}

/** One degraded-tolerant feed: each PayPal surface fails soft to [] so the widget still renders. */
export async function activityRows(signal?: AbortSignal): Promise<AdapterResult<ActivityRow[]>> {
  if (!isOn("studio")) return degrade("studio off");
  return guard("studio", async () => {
    const [invoices, transactions, balances] = await Promise.all([
      fetchInvoices(signal).catch(() => [] as InvoiceRow[]),
      fetchTransactions(signal).catch(() => [] as TransactionRow[]),
      fetchBalances(signal).catch(() => [] as BalanceRow[]),
    ]);
    return { ok: true as const, data: [...invoices, ...transactions, ...balances] };
  });
}
