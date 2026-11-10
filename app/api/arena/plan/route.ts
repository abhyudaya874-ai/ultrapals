import { z } from "zod";
import { MAX_SLOTS, MIN_SLOTS } from "@/lib/arena/plan";
import { proposePlan } from "@/lib/arena/run";
import { defaultDeps } from "@/lib/computer/ctx";
import { modelDepsFor, parseChoice } from "@/lib/computer/models";
import { allow } from "@/lib/research/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  kind: z.enum(["battle", "loop"]),
  n: z.number().int().min(MIN_SLOTS).max(MAX_SLOTS),
  scenario: z.string().trim().min(5).max(1500),
  model: z.unknown().optional(),
});

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/**
 * Drafts the scenarios of a Battle or a Loop so a person can read, edit and approve them before anything runs. It writes nothing and runs
 * nothing: the plan comes back as data, and `drafted` says whether a model wrote it (false means the fixed default line-up was used).
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  if (!allow(`arena-plan:${ipOf(req)}`, Date.now(), 6)) return Response.json({ error: "slow down: 6 drafts per minute" }, { status: 429, headers: { "Retry-After": "20" } });
  const b = parsed.data;
  const deps = { ...defaultDeps, model: modelDepsFor(defaultDeps.model, parseChoice(b.model)) };
  const out = await proposePlan(b.kind, b.n, b.scenario, deps, req.signal);
  return Response.json(out);
}
