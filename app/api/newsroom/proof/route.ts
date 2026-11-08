import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { promise } from "@/db/schema";
import { articleBySlug } from "@/lib/newsroom";
import { articleFromProofUrl } from "@/lib/newsroom-access";
import { paypal } from "@/lib/paypal";
import type { Condition } from "@/lib/verdict";

export const dynamic = "force-dynamic";

const UNLOCKED = new Set(["APPROVED", "COMPLETED"]); // sandbox order approved by the buyer, capture may still be pending

/**
 * The condition evidence for a paywall promise: `unlocked:<slug>` appears only when PayPal confirms an APPROVED
 * (or already COMPLETED) order for a promise conditioned on THIS article. `locked:<slug>` otherwise — including
 * when nothing can be seen, which the verdict maps to WAIT, never capture.
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("article") ?? "";
  if (!articleBySlug(slug)) return new Response("unknown article\n", { status: 404 });

  const rows = await getDb()
    .select({ paypalOrderId: promise.paypalOrderId, condition: promise.condition })
    .from(promise)
    .where(sql`${promise.condition}->>'kind' = 'page_contains'`);

  for (const r of rows) {
    const c = r.condition as Condition;
    if (c.kind !== "page_contains" || articleFromProofUrl(c.url) !== slug || !r.paypalOrderId) continue;
    const o = await paypal.getOrder(r.paypalOrderId, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (o?.ok && UNLOCKED.has(o.orderStatus)) {
      return new Response(`unlocked:${slug} order=${o.orderStatus}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  return new Response(`locked:${slug}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
