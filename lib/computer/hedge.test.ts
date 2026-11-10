import { beforeEach, describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import { callModelHedged, resetCooldowns, type ModelDeps } from "./model";
import { stream } from "./fakes";

const M = [{ provider: "groq" as const, model: "g/a" }, { provider: "groq" as const, model: "g/b" }, { provider: "groq" as const, model: "g/c" }];
const sse = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
const bad = (reason: string) => ({ ok: false as const, degraded: true as const, reason });
const ok = (p: "groq", m: string, t: string) => ({ ok: true as const, data: { provider: p, model: m, body: stream(sse(t)) } });
const run = async (deps: ModelDeps) => { const g = callModelHedged("x", [], deps); for (;;) { const n = await g.next(); if (n.done) return n.value; } };

beforeEach(resetCooldowns);

describe("callModelHedged", () => {
  it("returns the fast model's reply while the first model is stalled, and aborts the loser", async () => {
    let aborted = false;
    const open = (async (p: "groq", m: string, _msgs: unknown, o: { signal?: AbortSignal }) => {
      if (m === "g/a") return new Promise((res) => o.signal?.addEventListener("abort", () => { aborted = true; res(bad("groq: aborted")); }));
      return ok(p, m, "fast");
    }) as unknown as typeof openChat;
    const r = await run({ open, models: M, now: () => 1, hedge: 2 });
    expect(r).toMatchObject({ ok: true, text: "fast" });
    expect(aborted).toBe(true);
  });
  it("an aborted loser does not put a healthy model on cooldown", async () => {
    const hits: string[] = [];
    const open = (async (p: "groq", m: string, _x: unknown, o: { signal?: AbortSignal }) => {
      hits.push(m);
      if (m === "g/a") return new Promise((res) => o.signal?.addEventListener("abort", () => res(bad("groq: aborted"))));
      return ok(p, m, "fast");
    }) as unknown as typeof openChat;
    const deps: ModelDeps = { open, models: M, now: () => 1, hedge: 2 };
    await run(deps);
    hits.length = 0;
    await run(deps);
    expect(hits).toContain("g/a");
  });
  it("reports failure only when every raced model failed", async () => {
    const r = await run({ open: (async () => bad("groq http 400")) as unknown as typeof openChat, models: M, now: () => 1, hedge: 2 });
    expect(r.ok).toBe(false);
  });
  it("hedge 1 (the default) behaves exactly like callModel: one request", async () => {
    let n = 0;
    const open = (async (p: "groq", m: string) => { n++; return ok(p, m, "x"); }) as unknown as typeof openChat;
    await run({ open, models: M, now: () => 1 });
    expect(n).toBe(1);
  });
});
