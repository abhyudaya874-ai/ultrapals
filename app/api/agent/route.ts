import { z } from "zod";
import { defaultDeps } from "@/lib/computer/ctx";
import { loadPageContext } from "@/lib/computer/context";
import { AgentBody, MAX_BODY_BYTES } from "@/lib/computer/request";
import { modelDepsFor, parseChoice, roundsFor } from "@/lib/computer/models";
import { runMain } from "@/lib/computer/main-agent";
import { endSession, getSession, hasSession } from "@/lib/computer/session";
import { closeBrowser } from "@/lib/integrations/kbrowser";
import { allow } from "@/lib/research/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // paywall unlocks run create -> live approval -> settle -> browser read; 300s was not enough


const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

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
  if (b.sessionId && !hasSession(b.sessionId)) return Response.json({ error: "session expired: start a new conversation" }, { status: 410 });
  const session = getSession(b.sessionId, closeBrowser);
  if (session.busy) return Response.json({ error: "the agent is still working on your last message" }, { status: 409 });
  session.busy = true;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const pageContext = await loadPageContext(b.path);
        const choice = parseChoice(b.model);
        const deps = { ...defaultDeps, model: modelDepsFor(defaultDeps.model, choice) };
        for await (const e of runMain(session, { prompt: b.message, attachments: b.attachments, path: b.path, pageContext, images: b.images, maxRounds: roundsFor(choice), tzOffsetMin: b.tz }, deps, req.signal)) send(e);
      } catch (e) {
        send({ kind: "error", message: e instanceof Error ? e.message : "agent failed" });
      } finally {
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
