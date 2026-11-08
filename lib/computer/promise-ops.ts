import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { promise } from "@/db/schema";
import { getEnv } from "@/lib/env";
import type { AdapterResult } from "@/lib/integrations/types";
import { degrade } from "@/lib/integrations/registry";
import type { Condition } from "@/lib/verdict";

export interface PromiseInfo {
  id: string;
  title: string;
  state: string;
  amountMinor: number;
  currency: string;
  paypalOrderId: string | null;
  condition: Condition;
  windowEndsAt: Date;
}

export interface PromiseCreateInput {
  title: string;
  amount: string;
  currency: "USD" | "EUR" | "GBP";
  windowMinutes: number;
  payerName?: string;
  condition?: Condition;
}

/** Same contract as guard() but for our own API/db — the promise agent is not a vendor capability. */
async function pg<T>(fn: () => Promise<AdapterResult<T>>): Promise<AdapterResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return degrade(`promise: ${e instanceof Error ? e.message : "failed"}`);
  }
}

const toInfo = (p: typeof promise.$inferSelect): PromiseInfo => ({
  id: p.id,
  title: p.title,
  state: p.state,
  amountMinor: p.amountMinor,
  currency: p.currency,
  paypalOrderId: p.paypalOrderId,
  condition: p.condition as Condition,
  windowEndsAt: p.windowEndsAt,
});

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch(`${getEnv().APP_URL}/api/promise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(130_000),
  });
}

/** The only write path the agent may use: the same /api/promise endpoint the UI uses. Never computeVerdict, never a direct capture. */
export async function createPromise(input: PromiseCreateInput): Promise<AdapterResult<{ promiseId: string }>> {
  return pg(async () => {
    const res = await post({ op: "create", payerName: "computer-agent", ...input });
    if (!res.ok) return degrade(`create http ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { promiseId?: string };
    return j.promiseId ? { ok: true, data: { promiseId: j.promiseId } } : degrade("create: no promiseId");
  });
}

/** Fires the settle cycle and waits for its SSE stream to close (the route writes done/error then closes). */
export async function settlePromise(promiseId: string, signal?: AbortSignal): Promise<AdapterResult<null>> {
  return pg(async () => {
    const res = await post({ op: "settle", promiseId, attempt: 1 }, signal);
    if (!res.ok || !res.body) return degrade(`settle http ${res.status}`);
    await res.text(); // consumes the whole trace stream until the route closes it
    return { ok: true, data: null };
  });
}

export async function promiseInfo(promiseId: string): Promise<AdapterResult<PromiseInfo | null>> {
  return pg(async () => {
    const [p] = await getDb().select().from(promise).where(eq(promise.id, promiseId)).limit(1);
    return { ok: true, data: p ? toInfo(p) : null };
  });
}

/** Recent promises whose title matches any keyword (status questions like "what happened to my Nike promise?"). */
export async function findPromises(keywords: string[]): Promise<AdapterResult<PromiseInfo[]>> {
  return pg(async () => {
    const rows = await getDb().select().from(promise).orderBy(desc(promise.createdAt)).limit(40);
    const kws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 3);
    const hit = rows.filter((p) => kws.length === 0 || kws.some((k) => p.title.toLowerCase().includes(k)));
    return { ok: true, data: hit.slice(0, 8).map(toInfo) };
  });
}
