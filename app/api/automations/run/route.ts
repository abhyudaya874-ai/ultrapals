import { z } from "zod";
import { liveTickDeps } from "@/lib/automations/scheduler";
import { startNow } from "@/lib/automations/tick";
import { allow } from "@/lib/research/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Body = z.object({ id: z.string().uuid() });

/** "Run now": starts the run in the background and answers 202 at once. The page polls GET /api/automations for the result. */
export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(`automations-run:${ip}`, Date.now(), 6)) return Response.json({ error: "slow down: 6 runs per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "id must be a uuid" }, { status: 400 });
  const r = await startNow(p.data.id, liveTickDeps());
  return r.ok ? Response.json({ started: r.id }, { status: 202 }) : Response.json({ error: r.why }, { status: 409 });
}
