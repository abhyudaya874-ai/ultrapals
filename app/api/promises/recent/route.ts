import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { promise } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only. Feeds the sidebar, latest first. Money stays integer minor units; the client formats with formatMajor. */
export async function GET(req: Request): Promise<Response> {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 40);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 100) : 40;
  const rows = await getDb()
    .select({ id: promise.id, title: promise.title, state: promise.state, amountMinor: promise.amountMinor, currency: promise.currency, createdAt: promise.createdAt })
    .from(promise)
    .orderBy(desc(promise.createdAt))
    .limit(limit);
  return Response.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
}
