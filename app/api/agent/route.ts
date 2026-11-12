import { z } from "zod";
import { parseMode } from "@/lib/arena/mode";
import { readPlan } from "@/lib/arena/plan";
import { proposePlan, runArena } from "@/lib/arena/run";
import { PAL_NAMES } from "@/lib/computer/pals";
import { defaultDeps } from "@/lib/computer/ctx";
import { loadPageContext } from "@/lib/computer/context";
import { AgentBody, MAX_BODY_BYTES } from "@/lib/computer/request";
import { modelDepsFor, parseChoice, roundsFor } from "@/lib/computer/models";
import { USER_TASK_STEPS } from "@/lib/computer/browser-agent";
import { runMain } from "@/lib/computer/main-agent";
import { endSession, getSession, hasSession } from "@/lib/computer/session";
import { closeBrowser } from "@/lib/integrations/kbrowser";
import { dailyGate } from "@/lib/budget/daily";
import { getEnv } from "@/lib/env";
import { allow } from "@/lib/research/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // paywall unlocks run create -> live approval -> settle -> browser read; 300s was not enough


const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/** A Battle or Loop opens several cloud computers at once, so only a couple may run at the same time on one server. */
const MAX_CONTESTS = 2;
let contests = 0;

/**
 * The unified agent: ONE endpoint, ONE stream of CEvents. The main agent plans and delegates to research / browser /
 * terminal subagents that share one cloud VM. It touches no verdict and no money; promise data is read-only context.
 * The session id comes back in `x-session-id`; send it with the next message to continue in the same VM.
 */
export async function POST(req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "request too large: attach fewer or smaller images" }, { status: 413 });
  const parsed = AgentBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  if (!allow(`agent:${ipOf(req)}`, Date.now(), 6)) return Response.json({ error: "slow down: 6 messages per minute" }, { status: 429, headers: { "Retry-After": "30" } });

  const b = parsed.data;
  const caps = { run: getEnv().DAILY_RUN_CAP, contest: getEnv().DAILY_CONTEST_CAP };
  const day = dailyGate(ipOf(req), "run", caps);
  if (!day.ok) return Response.json({ error: day.error }, { status: 429, headers: { "Retry-After": String(day.retryAfterSec) } });
  const mode = parseMode(b.mode);
  // A contest is checked before anything starts: its own rate limit, the room for it, and a plan that can run.
  let approved: ReturnType<typeof readPlan> | null = null;
  if (mode.kind !== "chat") {
    if (!allow(`arena:${ipOf(req)}`, Date.now(), 2)) return Response.json({ error: "slow down: 2 battles or loops per minute" }, { status: 429, headers: { "Retry-After": "30" } });
    const contestDay = dailyGate(ipOf(req), "contest", caps);
    if (!contestDay.ok) return Response.json({ error: contestDay.error }, { status: 429, headers: { "Retry-After": String(contestDay.retryAfterSec) } });
    if (contests >= MAX_CONTESTS) return Response.json({ error: "two battles or loops are already running: try again when one finishes" }, { status: 429, headers: { "Retry-After": "60" } });
    if (mode.plan !== "auto") {
      approved = readPlan(b.approved);
      if (!approved.ok) return Response.json({ error: `The plan cannot run: ${approved.problems.join("; ")}.` }, { status: 400 });
      if (approved.plan.kind !== mode.kind) return Response.json({ error: `The plan is for a ${approved.plan.kind}, but the input is set to ${mode.kind}.` }, { status: 400 });
    }
  }
  if (b.sessionId && !hasSession(b.sessionId)) return Response.json({ error: "session expired: start a new conversation" }, { status: 410 });
  const session = getSession(b.sessionId, closeBrowser);
  if (session.busy) return Response.json({ error: "the agent is still working on your last message" }, { status: 409 });
  session.busy = true;
  const contest = mode.kind !== "chat";
  if (contest) contests++;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const choice = parseChoice(b.model);
        const deps = { ...defaultDeps, model: modelDepsFor(defaultDeps.model, choice) };
        if (mode.kind !== "chat") {
          // Autopilot drafts the scenarios now; otherwise the person's approved plan was already checked above.
          let plan = approved?.ok ? approved.plan : null;
          if (!plan) {
            send({ kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "running" });
            send({ kind: "step", agent: "main", id: "plan", label: mode.kind === "battle" ? "Choosing the teams and their predictions" : "Choosing the scenarios", state: "running" });
            plan = (await proposePlan(mode.kind, mode.n, b.message, deps, req.signal)).plan;
            send({ kind: "step", agent: "main", id: "plan", label: mode.kind === "battle" ? "Chose the teams and their predictions" : "Chose the scenarios", state: "ok" });
          }
          const arena = { open: () => getSession(undefined, closeBrowser), close: async (s: { id: string }) => { await endSession(s.id, closeBrowser); }, now: Date.now };
          for await (const e of runArena(session, { prompt: b.message, plan, planMode: mode.plan, choice }, deps, arena, req.signal)) send(e);
          return;
        }
        const pageContext = await loadPageContext(b.path);
        // An instruction typed into the live browser's own box goes straight to the browser agent, on the page that is already open.
        const browse = b.browse ? { firstDelegate: { agent: "browser" as const, task: b.message }, browserSteps: USER_TASK_STEPS } : {};
        for await (const e of runMain(session, { prompt: b.message, attachments: b.attachments, path: b.path, pageContext, images: b.images, maxRounds: b.browse ? 3 : roundsFor(choice), tzOffsetMin: b.tz, interactive: true, ...browse }, deps, req.signal)) send(e);
      } catch (e) {
        send({ kind: "error", message: e instanceof Error ? e.message : "agent failed" });
      } finally {
        if (contest) contests--;
        session.busy = false;
        session.lastUsed = Date.now();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "x-session-id": session.id } });
}

/** Ends a conversation and deletes its cloud VM (it bills while alive). */
export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "sessionId required" }, { status: 400 });
  return Response.json({ ended: await endSession(id, closeBrowser) });
}
