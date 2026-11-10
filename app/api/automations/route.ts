import { z } from "zod";
import { Spec } from "@/lib/automations/core";
import { toPublic } from "@/lib/automations/public";
import { automationStore } from "@/lib/automations/store";
import { runningNow } from "@/lib/automations/tick";
import { getEnv } from "@/lib/env";
import { allow } from "@/lib/research/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
const Id = z.string().uuid();

/** The list (no file contents), or one automation with its runs and files when `?id=` is given. */
export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  const now = Date.now();
  const store = automationStore();
  const meta = { now, busy: runningNow(), scheduler: getEnv().AUTOMATIONS_SCHEDULER };
  if (id) {
    if (!Id.safeParse(id).success) return Response.json({ error: "id must be a uuid" }, { status: 400 });
    const a = await store.get(id);
    return a ? Response.json({ ...meta, automation: toPublic(a, now, true) }) : Response.json({ error: "no such automation" }, { status: 404 });
  }
  return Response.json({ ...meta, automations: (await store.list()).map((a) => toPublic(a, now, false)) });
}

/** Creates an automation. It runs the whole agent team unattended (everyone but PromisePal), so the limits in core.ts apply. */
export async function POST(req: Request): Promise<Response> {
  if (!allow(`automations:${ipOf(req)}`, Date.now(), 12)) return Response.json({ error: "slow down: 12 changes per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  const p = Spec.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const r = await automationStore().create(p.data, Date.now());
  return r.ok ? Response.json({ automation: toPublic(r.automation, Date.now(), false) }, { status: 201 }) : Response.json({ error: r.reason }, { status: 409 });
}

const Patch = z.object({ id: Id, name: Spec.shape.name.optional(), prompt: Spec.shape.prompt.optional(), schedule: Spec.shape.schedule.optional(), level: Spec.shape.level.optional(), enabled: z.boolean().optional(), tzOffsetMin: Spec.shape.tzOffsetMin.optional() });

/** Edit, pause or resume. A schedule change moves the next run; a name change does not. */
export async function PATCH(req: Request): Promise<Response> {
  if (!allow(`automations:${ipOf(req)}`, Date.now(), 12)) return Response.json({ error: "slow down: 12 changes per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const { id, ...patch } = p.data;
  const a = await automationStore().update(id, patch, Date.now());
  return a ? Response.json({ automation: toPublic(a, Date.now(), false) }) : Response.json({ error: "no such automation, or the change was not valid" }, { status: 404 });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!Id.safeParse(id).success) return Response.json({ error: "id must be a uuid" }, { status: 400 });
  return Response.json({ removed: await automationStore().remove(id) });
}
