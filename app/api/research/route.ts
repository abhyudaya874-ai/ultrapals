import { z } from "zod";
import { allow } from "@/lib/research/rate-limit";
import { research } from "@/lib/research/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ question: z.string().trim().min(3).max(400) });

/**
 * Read-only research: web search -> free LLM -> cited answer, streamed as SSE `data: <ResearchEvent>`.
 * It touches no promise, no verdict and no money. Vendors degrade to a visible step, never a thrown error.
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "question must be 3-400 characters" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip, Date.now())) return Response.json({ error: "slow down: 8 questions per minute" }, { status: 429, headers: { "Retry-After": "30" } });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of research(parsed.data.question, req.signal)) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      } catch (e) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ kind: "error", message: e instanceof Error ? e.message : "research failed" })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
