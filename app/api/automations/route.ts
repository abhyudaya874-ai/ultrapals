import { z } from "zod";
import { Spec } from "@/lib/automations/core";
import { toBrief, toPublic } from "@/lib/automations/public";
import { automationStore, heavyReason } from "@/lib/automations/store";
import { runningNow } from "@/lib/automations/tick";
import { getEnv } from "@/lib/env";
import { allow } from "@/lib/research/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
const Id = z.string().uuid();

/** The list (no file contents), `?brief=1` for the light listing the sidebar polls, or one automation with its runs and files when `?id=` is given. */
export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const now = Date.now();
  const store = automationStore();
  const meta = { now, busy: runningNow(), scheduler: getEnv().AUTOMATIONS_SCHEDULER };
  if (id) {
    if (!Id.safeParse(id).success) return Response.json({ error: "id must be a uuid" }, { status: 400 });
    const a = await store.get(id);
    return a ? Response.json({ ...meta, automation: toPublic(a, now, true) }) : Response.json({ error: "no such automation" }, { status: 404 });
  }
  if (params.get("brief") === "1") return Response.json({ ...meta, automations: (await store.list()).map(toBrief) });
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

// The kind of an automation is chosen when it is made and does not change: its limits and how it runs depend on it.
const Patch = z.object({ id: Id, name: Spec.shape.name.optional(), prompt: Spec.shape.prompt.optional(), schedule: Spec.shape.schedule.optional(), level: Spec.shape.level.optional(), enabled: z.boolean().optional(), tzOffsetMin: Spec.shape.tzOffsetMin.optional(), count: Spec.shape.count });

/** Edit, pause or resume. A schedule change moves the next run; a name change does not. */
export async function PATCH(req: Request): Promise<Response> {
  if (!allow(`automations:${ipOf(req)}`, Date.now(), 12)) return Response.json({ error: "slow down: 12 changes per minute" }, { status: 429, headers: { "Retry-After": "30" } });
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const { id, ...patch } = p.data;
  const store = automationStore();
  const cur = await store.get(id);
  if (!cur) return Response.json({ error: "no such automation" }, { status: 404 });
  const next = Spec.safeParse({ ...cur, ...patch });
  if (!next.success) return Response.json({ error: next.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const a = await store.update(id, patch, Date.now());
  return a ? Response.json({ automation: toPublic(a, Date.now(), false) }) : Response.json({ error: heavyReason() }, { status: 409 });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!Id.safeParse(id).success) return Response.json({ error: "id must be a uuid" }, { status: 400 });
  return Response.json({ removed: await automationStore().remove(id) });
}
