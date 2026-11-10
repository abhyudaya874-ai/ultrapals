import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { probePayPal, probeSquare, probeStripe } from "@/lib/integrations/rails";
import { DEFAULT_SCHEDULES, dueJobs } from "@/lib/proctor/core";
import { runDue } from "@/lib/proctor/run";
import { proctorStore } from "@/lib/proctor/store";
import { allow } from "@/lib/research/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The schedule, the last result of each job, the runs and the cases opened. Read-only. */
export async function GET(): Promise<Response> {
  const s = proctorStore.get();
  const now = Date.now();
  return Response.json({
    now,
    schedules: DEFAULT_SCHEDULES.map((x) => ({ ...x, lastRunMs: s.lastRunMs[x.job] ?? null, due: dueJobs([x], s.lastRunMs, now).length > 0 })),
    runs: s.runs.slice(0, 20),
    cases: s.cases.slice(0, 20),
    durable: false,
  });
}

/**
 * Runs whatever is due. Meant for a timer (the Render sweep). With PROCTOR_TOKEN set, the caller must send it in `x-proctor-token`.
 * Zero model calls: it makes the same sandbox calls SituationPal makes, against Stripe's and Square's test environments and a read of PayPal's.
 */
export async function POST(req: Request): Promise<Response> {
  const token = getEnv().PROCTOR_TOKEN;
  if (token && !same(req.headers.get("x-proctor-token") ?? "", token)) return Response.json({ error: "x-proctor-token is missing or wrong" }, { status: 401 });
  if (!allow("proctor", Date.now(), 4)) return Response.json({ error: "slow down: 4 runs per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const runs = await runDue(
    { probes: { stripe: (id) => probeStripe(id), square: (id) => probeSquare(id), paypal: () => probePayPal(null) }, now: Date.now, id: () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` },
    force ? DEFAULT_SCHEDULES.map((x) => ({ ...x, everyMs: 60_000 })) : DEFAULT_SCHEDULES,
  );
  return Response.json({ ran: runs });
}
