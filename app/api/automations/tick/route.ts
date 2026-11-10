import { liveTickDeps } from "@/lib/automations/scheduler";
import { tickDue } from "@/lib/automations/tick";
import { getEnv } from "@/lib/env";
import { allow } from "@/lib/research/rate-limit";
import { same } from "@/lib/automations/token";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Runs the one most overdue automation, if any. For a host that wakes the app from outside (a cron job, Render's scheduler) instead of
 * relying on the in-process timer. With AUTOMATIONS_TOKEN set, the caller must send it in `x-automations-token`.
 */
export async function POST(req: Request): Promise<Response> {
  const token = getEnv().AUTOMATIONS_TOKEN;
  if (token && !same(req.headers.get("x-automations-token") ?? "", token)) return Response.json({ error: "x-automations-token is missing or wrong" }, { status: 401 });
  if (!allow("automations-tick", Date.now(), 6)) return Response.json({ error: "slow down: 6 ticks per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  return Response.json(await tickDue(liveTickDeps(), req.signal));
}
