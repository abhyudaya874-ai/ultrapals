import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { promise, promiseEvent } from "@/db/schema";
import { formatMajor } from "@/lib/money";

export interface VerdictRow {
  id: string; // the verdict event id: unique per row — Studio keys rows by it, promiseId alone collides after a re-settle
  promiseId: string;
  payer: string;
  title: string;
  amount: string; // "12.50 USD", display only
  amountMinor: number;
  currency: string;
  state: string;
  reason: string;
  kind: string;
  consequence: string;
  at: string;
}

/** The ONE query behind the Studio dashboard, the scoreboard widget and the timeline. Latest verdict first. */
export async function queryVerdictRows(limit: number): Promise<VerdictRow[]> {
  const rows = await getDb()
    .select({
      id: promiseEvent.id,
      promiseId: promise.id,
      payer: promise.payerName,
      title: promise.title,
      amountMinor: promise.amountMinor,
      currency: promise.currency,
      state: promise.state,
      reason: sql<string>`${promiseEvent.payload}->'verdict'->>'reason'`,
      kind: sql<string>`${promiseEvent.payload}->'verdict'->>'kind'`,
      consequence: sql<string>`${promiseEvent.payload}->'verdict'->>'consequence'`,
      at: promiseEvent.createdAt,
    })
    .from(promiseEvent)
    .innerJoin(promise, eq(promise.id, promiseEvent.promiseId))
    .where(eq(promiseEvent.kind, "verdict"))
    .orderBy(desc(promiseEvent.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    amount: `${formatMajor(r.amountMinor, r.currency)} ${r.currency}`,
    at: r.at.toISOString(),
  }));
}
