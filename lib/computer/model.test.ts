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
  it("round-robins the whole roster so successive steps start on different models", () => {
    expect(orderModels(M, 0, 0, new Map()).map((m) => m.model)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 1, 0, new Map()).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free", "g/a"]);
    expect(orderModels(M, 4, 0, new Map()).map((m) => m.model)).toEqual(["g/a", "g/b", "o/c:free", "o/d:free"]);
  });
  it("skips models still cooling down (keyed per provider:model), but never returns an empty list", () => {
    expect(orderModels(M, 0, 100, new Map([["groq:g/a", 500]])).map((m) => m.model)).toEqual(["g/b", "o/c:free", "o/d:free"]);
    expect(orderModels(M, 0, 100, new Map(M.map((m) => [`${m.provider}:${m.model}`, 500]))).length).toBe(4);
  });
  it("a cooldown on one provider does not cool the same model id elsewhere", () => {
    const M2: ModelRef[] = [{ provider: "groq", model: "x/y" }, { provider: "tokenrouter", model: "x/y" }];
    expect(orderModels(M2, 0, 100, new Map([["groq:x/y", 500]])).map((m) => m.provider)).toEqual(["tokenrouter"]);
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
    expect(ev.filter((e) => e.kind !== "usage")).toEqual([{ kind: "reasoning", agent: "main", delta: "hm" }]);
    expect(ret).toMatchObject({ ok: true, text: '{"a":1}', model: "a", provider: "groq" });
  });
  it("streams answer deltas only when asked", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, sse({ content: "Hi " }, { content: "there" }));
    const text = (r: { ev: CEvent[] }) => r.ev.filter((e) => e.kind !== "usage");
    expect(text(await drain(callModel("main", [], deps(open), { answerDeltas: true })))).toEqual([{ kind: "answer", delta: "Hi " }, { kind: "answer", delta: "there" }]);
    expect(text(await drain(callModel("main", [], deps(open))))).toEqual([]);
  });
  it("falls back past a 429 and puts the rate-limited model on cooldown for the next call", async () => {
    const tried: string[] = [];
    const open = async (p: "groq", m: string) => { tried.push(m); return m === "g/a" ? bad("groq http 429") : ok(p, m, sse({ content: "ok" })); };
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    tried.length = 0;
    await drain(callModel("x", [], deps(open)));
    expect(tried).not.toContain("g/a");
  });
  it("benches an unfunded or retired model (402/403/404/410) for 10 minutes, not 1", async () => {
    let now = 1000;
    const d: ModelDeps = { open: (async (p: "groq", m: string) => (m === "g/a" ? bad("tokenrouter http 403") : ok(p, m, sse({ content: "ok" })))) as unknown as typeof openChat, models: M, now: () => now };
    await drain(callModel("x", [], d));
    now += 120_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).not.toContain("g/a");
    now += 600_000;
    expect(orderModels(M, 0, now).map((m) => m.model)).toContain("g/a");
  });
  it("hands each model its own deadline so a stalled one cannot eat the whole budget", async () => {
    const seen: AbortSignal[] = [];
    const open = async (p: "groq", m: string, _msgs: unknown, opts: { signal?: AbortSignal }) => { if (opts.signal) seen.push(opts.signal); return m === "g/a" ? bad("groq: The operation was aborted due to timeout") : ok(p, m, sse({ content: "ok" })); };
    expect((await drain(callModel("x", [], deps(open), { modelTimeoutMs: 5 }))).ret).toMatchObject({ ok: true, model: "b" });
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
  it("falls back when a stream errors before content, and reports when everything fails", async () => {
    const err = `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`;
    const open = async (p: "groq", m: string) => (m === "g/a" ? ok(p, m, err) : ok(p, m, sse({ content: "fine" })));
    expect((await drain(callModel("x", [], deps(open)))).ret).toMatchObject({ ok: true, model: "b" });
    resetCooldowns();
    expect((await drain(callModel("x", [], deps(async () => bad("down"))))).ret).toEqual({ ok: false, error: "every allowlisted model failed: down" });
  });
  it("stops promptly when aborted", async () => {
    const c = new AbortController();
    c.abort();
    expect((await drain(callModel("x", [], deps(async () => bad("x")), { signal: c.signal }))).ret).toEqual({ ok: false, error: "cancelled" });
  });
});

describe("callModel reports the tokens it used", () => {
  const withUsage = (...c: object[]) => c.map((x) => `data: ${JSON.stringify(x)}\n\n`).join("") + "data: [DONE]\n\n";
  const msgs = [{ role: "system" as const, content: "Answer briefly." }, { role: "user" as const, content: "What is 2+2?" }];
  it("tells the provider's own count, marked as counted, with the model's window", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, withUsage({ choices: [{ delta: { content: "Four." } }] }, { choices: [], usage: { prompt_tokens: 92, completion_tokens: 27 } }));
    const { ev, ret } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.filter((e) => e.kind === "usage")).toEqual([{ kind: "usage", agent: "main", prompt: 92, completion: 27, window: 128_000, model: "g/a", provider: "groq", exact: true }]);
    expect(ret).toMatchObject({ ok: true, usage: { prompt: 92, completion: 27, exact: true } });
  });
  it("reads Groq's count from x_groq as well", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, withUsage({ choices: [{ delta: { content: "Four." } }] }, { choices: [], x_groq: { usage: { prompt_tokens: 40, completion_tokens: 9 } } }));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.find((e) => e.kind === "usage")).toMatchObject({ prompt: 40, completion: 9, exact: true });
  });
  it("estimates from the actual messages and the text when the provider sent no count, thinking included, and says so", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, sse({ reasoning: "x".repeat(400) }, { content: "Four." }));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    const u = ev.find((e) => e.kind === "usage");
    expect(u).toMatchObject({ exact: false, window: 128_000 });
    expect(u && u.kind === "usage" && u.prompt).toBeGreaterThan(8);
    expect(u && u.kind === "usage" && u.completion).toBeGreaterThan(90); // the 400 characters of thinking count
  });
  it("only the model that answered is reported: a model that failed first costs no event", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 500") : ok(p, m, sse({ content: "ok" })));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.filter((e) => e.kind === "usage")).toHaveLength(1);
    expect(ev.find((e) => e.kind === "usage")).toMatchObject({ model: "g/b" });
  });
  it("a reply that was refused tells nothing: the next model's call is the one that counts", async () => {
    let n = 0;
    const open = async (p: "groq", m: string) => ok(p, m, sse({ content: n++ === 0 ? "prose" : '{"a":1}' }));
    const { ev, ret } = await drain(callModel("main", msgs, deps(open), { accept: (t) => t.startsWith("{") }));
    expect(ev.filter((e) => e.kind === "usage")).toHaveLength(1);
    expect(ret).toMatchObject({ ok: true, text: '{"a":1}' });
  });
});
describe("callModel tells the ring in real time when deps.live is on", () => {
  const msgs = [{ role: "system" as const, content: "Answer briefly." }, { role: "user" as const, content: "What is 2+2?" }];
  const many = (n: number) => sse(...Array.from({ length: n }, (_, i) => ({ content: `word${i} ` })));
  const clock = () => { let t = 0; return () => (t += 200); }; // every read is 200ms later: each piece of the stream is due a report
  const liveDeps = (open: unknown): ModelDeps => ({ open: open as typeof openChat, models: M, now: clock(), live: true });
  it("reports the prompt before the first word, then a growing reply, then the finished call", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(6));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(lives.length).toBeGreaterThan(2);
    expect(lives[0]).toMatchObject({ kind: "usage_live", agent: "main", completion: 0, model: "g/a", provider: "groq" });
    const done = lives.map((e) => (e.kind === "usage_live" ? e.completion : -1));
    expect(done).toEqual([...done].sort((a, b) => a - b)); // never shrinks while streaming
    expect(done.at(-1)).toBeGreaterThan(0);
    expect(ev.at(-1)?.kind).toBe("usage"); // the finished call is told last
  });
  it("every live report carries the same prompt count as the model was really given", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(4));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const prompts = new Set(ev.filter((e) => e.kind === "usage_live").map((e) => (e.kind === "usage_live" ? e.prompt : 0)));
    expect(prompts.size).toBe(1);
    expect([...prompts][0]).toBeGreaterThan(8);
  });
  it("reports nothing live when the flag is off (the default)", async () => {
    const open = async (p: "groq", m: string) => ok(p, m, many(6));
    const { ev } = await drain(callModel("main", msgs, deps(open)));
    expect(ev.some((e) => e.kind === "usage_live")).toBe(false);
  });
  it("announces each model as it is tried, so the last report always names the one that answered", async () => {
    const open = async (p: "groq", m: string) => (m === "g/a" ? bad("groq http 500") : ok(p, m, many(3)));
    const { ev } = await drain(callModel("main", msgs, liveDeps(open)));
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(lives[0]).toMatchObject({ model: "g/a", completion: 0 }); // tried first, failed: its report is replaced, not left behind
    expect(lives.slice(1).every((e) => e.kind === "usage_live" && e.model === "g/b")).toBe(true);
    expect(lives.at(-1)).toMatchObject({ model: "g/b" });
    expect(ev.at(-1)).toMatchObject({ kind: "usage", model: "g/b" });
  });
  it("reports the prompt before the model has even been asked, so a slow connection is not silence", async () => {
    let asked = false;
    const open = async (p: "groq", m: string) => { asked = true; return ok(p, m, many(2)); };
    const g = callModel("main", msgs, liveDeps(open));
    const first = await g.next();
    expect(first.value).toMatchObject({ kind: "usage_live", agent: "main", completion: 0, model: "g/a" });
    expect(asked).toBe(false);
  });
});

describe("callModel gives up on a model that says nothing", () => {
  const silent = (signal?: AbortSignal) => new ReadableStream<Uint8Array>({ start(c) { signal?.addEventListener("abort", () => c.error(new Error("This operation was aborted")), { once: true }); } });
  const opts = (o: unknown) => o as { signal?: AbortSignal };
  it("moves on from a stream that never sends a word, and benches that model", async () => {
    const tried: string[] = [];
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => { tried.push(m); return m === "g/a" ? { ok: true as const, data: { provider: p, model: m, body: silent(opts(o).signal) } } : ok(p, m, sse({ content: "ok" })); };
    const r = await drain(callModel("x", [], deps(open), { firstWordMs: 20 }));
    expect(r.ret).toMatchObject({ ok: true, model: "b" });
    expect(tried).toEqual(["g/a", "g/b"]);
    expect(orderModels(M, 0, 1000).map((m) => m.model)).not.toContain("g/a");
  });
  it("moves on from a connection that never answers at all", async () => {
    const open = (p: "groq", m: string, _msgs: unknown, o: unknown) => (m === "g/a"
      ? new Promise((res) => opts(o).signal?.addEventListener("abort", () => res(bad("groq: This operation was aborted")), { once: true }))
      : Promise.resolve(ok(p, m, sse({ content: "ok" }))));
    expect((await drain(callModel("x", [], deps(open), { firstWordMs: 20 }))).ret).toMatchObject({ ok: true, model: "b" });
  });
  it("says why when every model stayed silent", async () => {
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => ({ ok: true as const, data: { provider: p, model: m, body: silent(opts(o).signal) } });
    const r = await drain(callModel("x", [], { ...deps(open), models: M.slice(0, 2) }, { firstWordMs: 15 }));
    expect(r.ret).toMatchObject({ ok: false });
    expect((r.ret as { error: string }).error).toMatch(/sent nothing for/);
  });
  it("does not hurry a model that is thinking: thinking, or a word, ends the wait", async () => {
    // like a real connection, the body errors when the call is aborted
    const talker = (signal?: AbortSignal) => new ReadableStream<Uint8Array>({
      async start(c) {
        const enc = new TextEncoder();
        signal?.addEventListener("abort", () => { try { c.error(new Error("This operation was aborted")); } catch { /* already closed */ } }, { once: true });
        c.enqueue(enc.encode(sse({ reasoning: "hm" }).replace("data: [DONE]\n\n", "")));
        await new Promise((r) => setTimeout(r, 70)); // well past firstWordMs, but it has already spoken
        try { c.enqueue(enc.encode(sse({ content: "done" }))); c.close(); } catch { /* aborted */ }
      },
    });
    const open = async (p: "groq", m: string, _msgs: unknown, o: unknown) => ({ ok: true as const, data: { provider: p, model: m, body: talker(opts(o).signal) } });
    expect((await drain(callModel("x", [], deps(open), { firstWordMs: 20 }))).ret).toMatchObject({ ok: true, text: "done", model: "a" });
  });
});
