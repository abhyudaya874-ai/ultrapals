import { beforeEach, describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import type { CEvent } from "./events";
import { callModel, orderModels, resetCooldowns, type ModelDeps, type ModelRef } from "./model";

const M: ModelRef[] = [
  { provider: "groq", model: "g/a" }, { provider: "groq", model: "g/b" },
  { provider: "openrouter", model: "o/c:free" }, { provider: "openrouter", model: "o/d:free" },
];
beforeEach(resetCooldowns);

describe("orderModels", () => {
  it("rotates only the Groq pair so successive steps start on different models", () => {
    expect(orderModels(M, 0, 0, new Map()).map((m) => m.model)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 1, 0, new Map()).map((m) => m.model)).toEqual(["g/b", "g/a", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 2, 0, new Map()).map((m) => m.model)[0]).toBe("g/a");
  });
  it("skips models still cooling down, but never returns an empty list", () => {
    expect(orderModels(M, 0, 100, new Map([["g/a", 500]])).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 0, 100, new Map(M.map((m) => [m.model, 500]))).length).toBe(4);
  });
});

const sse = (...c: object[]) => c.map((x) => `data: ${JSON.stringify({ choices: [{ delta: x }] })}\n\n`).join("") + "data: [DONE]\n\n";
const stream = (t: string): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } });
const ok = (provider: "groq" | "openrouter", model: string, t: string) => ({ ok: true as const, data: { provider, model, body: stream(t) } });
const bad = (reason: string) => ({ ok: false as const, degraded: true as const, reason });
const deps = (open: unknown): ModelDeps => ({ open: open as typeof openChat, models: M, now: () => 1000 });

async function drain(g: AsyncGenerator<CEvent, unknown>) {
  const ev: CEvent[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { ev, ret: n.value };
    ev.push(n.value);
  }
}

describe("callModel", () => {
  it("streams reasoning as events and returns the content", async () => {
    const { ev, ret } = await drain(callModel("main", [], deps(async (p: "groq", m: string) => ok(p, m, sse({ reasoning: "hm" }, { content: '{"a":1}' })))));
    expect(ev).toEqual([{ kind: "reasoning", agent: "main", delta: "hm" }]);
    expect(ret).toEqual({ ok: true, text: '{"a":1}', model: "a", provider: "groq" });
  });
  it("streams answer deltas only when asked", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, sse({ content: "Hi " }, { content: "there" }));
    expect((await drain(callModel("main", [], deps(open), { answerDeltas: true }))).ev).toEqual([{ kind: "answer", delta: "Hi " }, { kind: "answer", delta: "there" }]);
    expect((await drain(callModel("main", [], deps(open)))).ev).toEqual([]);
  });
  it("falls back past a 429 and puts the rate-limited model on cooldown for the next call", async () => {
    const tried: string[] = [];
    const open = async (p: "groq", m: string) => { tried.push(m); return m === "g/a" ? bad("groq http 429") : ok(p, m, sse({ content: "ok" })); };
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    tried.length = 0;
    await drain(callModel("x", [], deps(open)));
    expect(tried).not.toContain("g/a");
  });
  it("falls back when a stream errors before content, and reports when everything fails", async () => {
    const err = `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`;
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, err) : ok(p, m, sse({ content: "fine" })));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    resetCooldowns();
    expect((await drain(callModel("x", [], deps(async () => bad("down"))))).ret).toEqual({ ok: false, error: "every free model failed: down" });
  });
  it("stops promptly when aborted", async () => {
    const c = new AbortController();
    c.abort();
    expect((await drain(callModel("x", [], deps(async () => bad("x")), { signal: c.signal }))).ret).toEqual({ ok: false, error: "cancelled" });
  });
});
