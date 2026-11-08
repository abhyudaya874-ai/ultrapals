import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { promise, promiseEvent } from "@/db/schema";
import { formatMajor } from "@/lib/money";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PromiseFacts {
  title: string;
  amountMinor: number;
  currency: string;
  state: string;
  windowEndsAt: Date;
  condition: { kind: string; [k: string]: unknown };
  events: { kind: string; payload: unknown; createdAt: Date }[];
}

/** Pure. Promise id from "/p?id=<uuid>", else null. */
export function promiseIdFromPath(path: string): string | null {
  const m = /^\/p\?(?:.*&)?id=([^&#]+)/.exec(path);
  return m && UUID.test(m[1]) ? m[1] : null;
}

/** Pure. A compact, factual summary for the main agent: stored values only; it never recomputes or re-decides anything. */
export function formatPromiseContext(p: PromiseFacts): string {
  const v = [...p.events].reverse().find((e) => e.kind === "verdict")?.payload as { verdict?: { kind?: string; reason?: string; consequence?: string } } | undefined;
  const c = p.condition;
  const cond = c.kind === "none" ? "no condition" : c.kind === "price_at_most" ? `price of "${String(c.query)}" must be at most ${String(c.ceilingMinor)} minor units` : c.kind === "page_contains" ? `page ${String(c.url)} must contain "${String(c.needle)}"` : c.kind;
  return [
    `Standing Promise "${p.title}": ${formatMajor(p.amountMinor, p.currency)} ${p.currency}, state ${p.state}, window ends ${p.windowEndsAt.toISOString()}.`,
    `Condition: ${cond}.`,
    v?.verdict ? `Latest stored verdict: ${v.verdict.reason} (${v.verdict.kind}) -> ${v.verdict.consequence}.` : "No verdict has been computed yet.",
    `Event log: ${p.events.map((e) => e.kind).join(" > ") || "empty"}.`,
  ].join("\n");
}

async function loadPromise(id: string): Promise<PromiseFacts | null> {
  const db = getDb();
  const [p] = await db.select().from(promise).where(eq(promise.id, id)).limit(1);
  if (!p) return null;
  const events = await db.select().from(promiseEvent).where(eq(promiseEvent.promiseId, id)).orderBy(asc(promiseEvent.createdAt));
  return { title: p.title, amountMinor: p.amountMinor, currency: p.currency, state: p.state, windowEndsAt: p.windowEndsAt, condition: p.condition as PromiseFacts["condition"], events: events.map((e) => ({ kind: e.kind, payload: e.payload, createdAt: e.createdAt })) };
}

/** What the agent knows about the screen the user is on. Read-only DB access; a failure just means no extra context. */
export async function loadPageContext(path: string, load: (id: string) => Promise<PromiseFacts | null> = loadPromise): Promise<string | null> {
  const id = promiseIdFromPath(path);
  if (!id) return null;
  try {
    const p = await load(id);
    return p ? formatPromiseContext(p) : null;
  } catch {
    return null;
  }
}
