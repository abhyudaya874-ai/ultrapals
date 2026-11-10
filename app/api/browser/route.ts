import { z } from "zod";
import { normalizeAddress } from "@/lib/browse/address";
import { defaultDeps, ensureVm } from "@/lib/computer/ctx";
import { findSession, type Session } from "@/lib/computer/session";
import { browserState, gotoUrl, navigate, vmAlive, type BrowserState } from "@/lib/integrations/kbrowser";
import { allow } from "@/lib/research/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("open") }),
  z.object({ op: z.literal("goto"), address: z.string().max(2100) }),
  z.object({ op: z.literal("back") }),
  z.object({ op: z.literal("forward") }),
  z.object({ op: z.literal("reload") }),
]);
const Body = z.object({ sessionId: z.string().uuid() }).and(Op);

/** The session's browser if it is still there. A browser Kernel has deleted is dropped from the session, so the next agent step starts a new one. */
async function liveBrowser(sessionId: string) {
  const s = findSession(sessionId);
  if (!s) return { error: "session expired", status: 410 as const };
  if (!s.vm) return { error: "no browser is open in this conversation yet", status: 404 as const };
  if (!(await vmAlive(s.vm))) {
    s.vm = null;
    return { error: "the browser has closed", status: 410 as const, closed: true };
  }
  s.vmCheckedAt = Date.now();
  s.lastUsed = Date.now(); // looking at it counts as using it, so the conversation's own idle timer does not delete it under you
  return { vm: s.vm };
}

/** Where the browser is now (URL, title, whether Back and Forward have somewhere to go). Polled by the browser window while it is open. */
export async function GET(req: Request): Promise<Response> {
  if (!allow(`browser-state:${ipOf(req)}`, Date.now(), 90)) return Response.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": "5" } });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("sessionId"));
  if (!id.success) return Response.json({ error: "sessionId required" }, { status: 400 });
  const found = await liveBrowser(id.data);
  if ("error" in found) return Response.json({ alive: false, error: found.error }, { status: found.status === 410 ? 200 : found.status });
  const st = await browserState(found.vm);
  return Response.json(st.ok ? { alive: true, state: st.data } : { alive: true, error: st.reason });
}

/**
 * The address bar and the back, forward and reload buttons of the live browser. Addresses go through the same checks as the agent's own navigation:
 * public web pages only (and the cloud computer's own localhost), never a private network address.
 */
export async function POST(req: Request): Promise<Response> {
  if (!allow(`browser-op:${ipOf(req)}`, Date.now(), 40)) return Response.json({ error: "slow down: 40 browser actions per minute" }, { status: 429, headers: { "Retry-After": "10" } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const b = parsed.data;
  if (b.op === "open") return openNew(b.sessionId, req);
  const found = await liveBrowser(b.sessionId);
  if ("error" in found) return Response.json({ ok: false, alive: false, error: found.error }, { status: found.status === 410 ? 200 : found.status });

  let search = false;
  let failed: string | null = null;
  if (b.op === "goto") {
    const a = normalizeAddress(b.address);
    if (!a.ok) return Response.json({ ok: false, alive: true, error: a.reason }, { status: 400 });
    search = a.search;
    const r = await gotoUrl(found.vm, a.url);
    if (!r.ok) failed = r.reason;
  } else {
    const r = await navigate(found.vm, b.op);
    if (!r.ok) failed = r.reason;
  }
  const st = await browserState(found.vm);
  const state: BrowserState | undefined = st.ok ? st.data : undefined;
  return Response.json({ ok: !failed, alive: true, search, ...(failed ? { error: failed } : {}), ...(state ? { state } : {}) });
}

/** Starts a new cloud browser for this conversation (or confirms the one it has). Costs money while it lives, so it is rationed harder than the other actions. */
async function openNew(sessionId: string, req: Request): Promise<Response> {
  const s: Session | undefined = findSession(sessionId);
  if (!s) return Response.json({ ok: false, alive: false, error: "session expired" }, { status: 200 });
  if (!allow(`browser-open:${ipOf(req)}`, Date.now(), 4, 5 * 60_000)) return Response.json({ ok: false, error: "slow down: 4 new browsers per 5 minutes" }, { status: 429, headers: { "Retry-After": "60" } });
  const g = ensureVm({ agent: "browser-ui", session: s, deps: defaultDeps });
  for (;;) {
    const n = await g.next();
    if (n.done) {
      const vm = n.value;
      if (!vm) return Response.json({ ok: false, alive: false, error: "could not start a browser (is Kernel on?)" }, { status: 200 });
      const st = await browserState(vm);
      return Response.json({ ok: true, alive: true, liveViewUrl: vm.liveViewUrl, ...(st.ok ? { state: st.data } : {}) });
    }
  }
}
