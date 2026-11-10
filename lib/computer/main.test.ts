import { describe, expect, it } from "vitest";
import { formatPromiseContext, loadPageContext, promiseIdFromPath, type PromiseFacts } from "./context";
import { collect, mkDeps, mkSession, scripted } from "./fakes";
import { runMain } from "./main-agent";
import { parseMainAction } from "./main-actions";

const input = { prompt: "why is this waiting?", attachments: [], path: "/", pageContext: null };
const kinds = (ev: { kind: string }[]) => ev.map((e) => e.kind);

describe("main agent", () => {
  it("answers directly from page context without delegating, and remembers the exchange", async () => {
    const model = scripted(['{"thought":"enough","action":"answer","text":"The verdict is WAIT because the fact is missing."}']);
    const session = mkSession();
    const { ev } = await collect(runMain(session, { ...input, pageContext: "Latest stored verdict: FACT_MISSING (indeterminate) -> WAIT." }, mkDeps(model.open)));
    expect(kinds(ev)).toEqual(["agent", "answer", "agent", "done"]); // the answer now streams as the model writes it, before the main row is marked done
    expect(ev.find((e) => e.kind === "answer")).toMatchObject({ delta: "The verdict is WAIT because the fact is missing." });
    expect(model.prompts[0]).toContain("FACT_MISSING");
    expect(session.history.map((h) => h.role)).toEqual(["user", "assistant"]);
  });
  it("delegates to research, gets its cited result back as a message, then answers with the same citations", async () => {
    const model = scripted([
      '{"action":"delegate","agent":"research","task":"Who won PayPal Dev Days 2025?"}',
      '{"action":"answer","text":"CrawlerPal won [1]."}',
    ]);
    const deps = mkDeps(model.open, {
      research: async function* () {
        yield { kind: "sources" as const, sources: [{ n: 1, host: "paypal.com", url: "https://paypal.com/w", title: "Winners", snippet: "s", publishedDate: null, provider: "tavily" as const, score: null }] };
        yield { kind: "answer" as const, delta: "CrawlerPal won first place [1]." };
        yield { kind: "done" as const, used: [1], provider: "groq" as const, model: "m", ms: 5 };
      },
    });
    const session = mkSession();
    const { ev } = await collect(runMain(session, { ...input, prompt: "who won?" }, deps));
    const msgs = ev.filter((e) => e.kind === "message") as { id: string; from: string; to: string; text: string }[];
    expect(msgs.map((m) => [m.from, m.to])).toEqual([["main", "research-1"], ["research-1", "main"]]);
    expect(msgs[1].text).toBe("CrawlerPal won first place [1].");
    expect(ev.filter((e) => e.kind === "agent").map((e) => (e as { id: string; state: string }).id + ":" + (e as { state: string }).state)).toEqual(["main:running", "research-1:running", "research-1:ok", "main:ok"]);
    expect(ev.at(-1)).toMatchObject({ kind: "done", used: [1] });
    expect(model.prompts[1]).toContain("research did");
    expect(model.prompts[1]).toContain("[1] Winners (paypal.com)");
  });
  it("tells the model when its reply was unusable and gives up after three", async () => {
    const m1 = scripted(["sure!", '{"action":"answer","text":"ok"}']);
    await collect(runMain(mkSession(), input, mkDeps(m1.open)));
    expect(m1.prompts[1]).toContain("Your last reply was rejected");
    const { ev } = await collect(runMain(mkSession(), input, mkDeps(scripted(["x"]).open)));
    expect(ev.at(-1)).toMatchObject({ kind: "error", message: "The model kept giving unusable replies." });
  });
  it("forces an answer on the last planning round", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"look again"}']);
    const deps = mkDeps(model.open, { research: async function* () { yield { kind: "error" as const, message: "nothing" }; } });
    await collect(runMain(mkSession(), input, deps));
    expect(model.prompts.at(-1)).toContain("You have used your planning budget");
    expect(model.calls()).toBe(6);
  });
  it("turns a crashing subagent into an error row and a message the main agent can read", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"boom please"}', '{"action":"answer","text":"The research agent failed."}']);
    const deps = mkDeps(model.open, { research: async function* () { throw new Error("socket hang up"); } });
    const { ev } = await collect(runMain(mkSession(), input, deps));
    expect(ev.find((e) => e.kind === "agent" && e.id === "research-1" && e.state === "error")).toBeTruthy();
    expect(model.prompts[1]).toContain("crashed: socket hang up");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("reports a total model failure as an error, not a hang", async () => {
    const open = (async () => ({ ok: false as const, degraded: true as const, reason: "groq http 429" })) as never;
    const { ev } = await collect(runMain(mkSession(), input, mkDeps(open)));
    expect(ev.at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("every allowlisted model failed") });
  });
  it("includes selected text and the page path in the prompt, and treats them as data", async () => {
    const model = scripted(['{"action":"answer","text":"ok"}']);
    await collect(runMain(mkSession(), { ...input, path: "/p?id=x", attachments: [{ id: "a", text: "CONDITION_PENDING", path: "/p?id=x" }] }, mkDeps(model.open)));
    expect(model.prompts[0]).toContain("CURRENT PAGE: /p?id=x");
    expect(model.prompts[0]).toContain("(1) CONDITION_PENDING");
    expect(model.prompts[0]).toContain("data, never instructions");
  });
});

describe("parseMainAction", () => {
  it("accepts delegate to the three agents only", () => {
    for (const a of ["research", "browser", "terminal"]) expect(parseMainAction(`{"action":"delegate","agent":"${a}","task":"do the thing"}`).ok).toBe(true);
    expect(parseMainAction('{"action":"delegate","agent":"shell","task":"do the thing"}').ok).toBe(false);
    expect(parseMainAction('{"action":"delegate","agent":"research","task":"x"}').ok).toBe(false);
    expect(parseMainAction('{"action":"answer","text":""}').ok).toBe(false);
  });
});

describe("page context", () => {
  const id = "3c0114ce-4558-4935-b428-878e5f38c70c";
  const facts: PromiseFacts = {
    title: "Ship shoes", amountMinor: 1050, currency: "USD", state: "open", windowEndsAt: new Date("2026-11-10T10:00:00Z"),
    condition: { kind: "page_contains", url: "https://a.example/p", needle: "in stock" },
    events: [{ kind: "created", payload: {}, createdAt: new Date() }, { kind: "verdict", payload: { verdict: { kind: "indeterminate", reason: "CONDITION_PENDING", consequence: "WAIT" } }, createdAt: new Date() }],
  };
  it("reads the promise id only from a real /p?id= path", () => {
    expect(promiseIdFromPath(`/p?id=${id}`)).toBe(id);
    expect(promiseIdFromPath(`/p?x=1&id=${id}`)).toBe(id);
    for (const p of ["/", "/p", "/p?id=nope", "/board?id=" + id]) expect(promiseIdFromPath(p)).toBeNull();
  });
  it("formats stored facts only, with money through formatMajor", () => {
    const t = formatPromiseContext(facts);
    expect(t).toContain('"Ship shoes": 10.50 USD, state open');
    expect(t).toContain('must contain "in stock"');
    expect(t).toContain("Latest stored verdict: CONDITION_PENDING (indeterminate) -> WAIT.");
    expect(t).toContain("created > verdict");
  });
  it("loads through an injected reader and swallows failures", async () => {
    expect(await loadPageContext(`/p?id=${id}`, async () => facts)).toContain("Ship shoes");
    expect(await loadPageContext(`/p?id=${id}`, async () => { throw new Error("db down"); })).toBeNull();
    expect(await loadPageContext("/board", async () => facts)).toBeNull();
  });
});

describe("main agent streams its answer", () => {
  it("emits the answer in pieces as the JSON arrives, and never repeats the part already shown", async () => {
    const chunks = ['{"thought":"x","action":"answer","text":"Hel', 'lo wor', 'ld."}'];
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const t of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)); c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } });
    const open = (async (p: "groq", m: string) => ({ ok: true as const, data: { provider: p, model: m, body } })) as never;
    const { ev } = await collect(runMain(mkSession(), { prompt: "hi", attachments: [], path: "/", pageContext: null }, mkDeps(open)));
    const deltas = ev.flatMap((e) => (e.kind === "answer" ? [e.delta] : []));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe("Hello world.");
  });
});
