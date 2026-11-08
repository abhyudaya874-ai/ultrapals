import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PromiseSurface } from "@/components/PromiseSurface";
import { getDb } from "@/db";
import { promise, promiseEvent } from "@/db/schema";
import { formatMajor } from "@/lib/money";
import { approveUrlFor } from "@/lib/paypal";
import type { Verdict } from "@/lib/verdict";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// @invariant:page-renders-without-network-or-llm  Only the local DB is read here.
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id || !UUID.test(id)) redirect("/");

  const db = getDb();
  const [p] = await db.select().from(promise).where(eq(promise.id, id)).limit(1);
  if (!p) redirect("/");
  const events = await db.select().from(promiseEvent).where(eq(promiseEvent.promiseId, id)).orderBy(asc(promiseEvent.createdAt));

  const lastVerdict = [...events].reverse().find((e) => e.kind === "verdict");
  const verdict = ((lastVerdict?.payload as { verdict?: Verdict } | undefined)?.verdict) ?? null;

  return (
    <main className="h-full">
      <PromiseSurface
        promise={{
          id: p.id,
          title: p.title,
          amountLabel: `${formatMajor(p.amountMinor, p.currency)} ${p.currency}`,
          currency: p.currency,
          windowEndsAtIso: p.windowEndsAt.toISOString(),
          state: p.state,
          conditionKind: p.condition.kind,
          condition: p.condition,
        }}
        approveUrl={p.paypalOrderId && p.state !== "captured" ? approveUrlFor(p.paypalOrderId) : null}
        log={events.map((e) => ({ id: e.id, kind: e.kind, attempt: e.attempt, createdAtIso: e.createdAt.toISOString() }))}
        verdict={verdict}
      />
    </main>
  );
}
