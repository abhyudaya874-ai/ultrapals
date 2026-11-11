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

describe("accept: an unusable reply is not a win", () => {
  it("callModel moves to the next model when the first reply fails validation", async () => {
    const open = (async (p: "groq", m: string) => ok(p, m, m === "g/a" ? "I cannot help with that" : '{"rivals":[1]}')) as unknown as typeof openChat;
    const g = callModelHedged("x", [], { open, models: M, now: () => 1 }, { accept: (t) => t.includes("rivals") });
    let r;
    for (;;) { const n = await g.next(); if (n.done) { r = n.value; break; } }
    expect(r).toMatchObject({ ok: true, text: '{"rivals":[1]}' });
  });
  it("a fast garbage reply does not beat a slower good one when racing", async () => {
    const open = (async (p: "groq", m: string, _x: unknown, o: { signal?: AbortSignal }) => {
      if (m === "g/b") return new Promise((res) => setTimeout(() => res(ok(p, m, '{"rivals":[1]}')), 30));
      void o;
      return ok(p, m, "garbage");
    }) as unknown as typeof openChat;
    const r = await run2({ open, models: M, now: () => 1, hedge: 2 }, (t) => t.includes("rivals"));
    expect(r).toMatchObject({ ok: true, text: '{"rivals":[1]}' });
  });
  it("reports failure when every model's reply is unusable", async () => {
    const open = (async (p: "groq", m: string) => ok(p, m, "garbage")) as unknown as typeof openChat;
    expect((await run2({ open, models: M, now: () => 1, hedge: 2 }, () => false)).ok).toBe(false);
  });
});
async function run2(deps: ModelDeps, accept: (t: string) => boolean) {
  const g = callModelHedged("x", [], deps, { accept });
  for (;;) { const n = await g.next(); if (n.done) return n.value; }
}
describe("callModelHedged and the live token count", () => {
  const many = (n: number) => `${Array.from({ length: n }, (_, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: `w${i} ` } }] })}\n\n`).join("")}data: [DONE]\n\n`;
  const okMany = (p: "groq", m: string) => ({ ok: true as const, data: { provider: p, model: m, body: stream(many(6)) } });
  it("tells once that the race began, then follows the one racer that streams first, then the finished call", async () => {
    let t = 0;
    const deps: ModelDeps = { open: (async (p: "groq", m: string) => okMany(p, m)) as unknown as typeof openChat, models: M, now: () => (t += 200), hedge: 2, live: true };
    const g = callModelHedged("x", [{ role: "user", content: "hi" }], deps);
    const ev: { kind: string; model?: string; completion?: number }[] = [];
    for (;;) { const n = await g.next(); if (n.done) break; ev.push(n.value as never); }
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(ev[0]).toMatchObject({ kind: "usage_live", completion: 0 }); // the very first thing told: the prompt is on its way
    expect(lives.filter((e) => (e.completion ?? 0) === 0)).toHaveLength(1); // one opening report for the race; the racers' own are dropped
    const streamed = lives.slice(1);
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed.every((e) => (e.completion ?? 0) > 0)).toBe(true);
    expect(new Set(streamed.map((e) => e.model)).size).toBe(1); // one racer is followed, not both
    expect(ev.at(-1)?.kind).toBe("usage");
  });
});

