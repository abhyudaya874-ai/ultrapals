import { describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import type { WebSource } from "@/lib/integrations/types";
import { research, type Deps, type ResearchEvent } from "./run";

const web = (url: string, provider: WebSource["provider"] = "tavily"): WebSource => ({ url, title: url, snippet: `about ${url}`, publishedDate: null, provider, score: null });
const sse = (...chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: c }] })}\n\n`).join("") + "data: [DONE]\n\n";
const stream = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
const ok = (model: string, text: string) => ({ ok: true as const, data: { provider: "groq" as const, model, body: stream(text) } });
const bad = (reason: string) => ({ ok: false as const, degraded: true as const, reason });

const base = (open: Deps["open"]): Deps => ({
  searchers: [
    { id: "tavily", label: "Tavily", run: async () => ({ ok: true, data: [web("https://a.example/1")] }) },
    { id: "exa", label: "Exa", run: async () => ({ ok: true, data: [web("https://b.example/2", "exa")] }) },
  ],
  open,
  models: [{ provider: "groq", model: "m1" }, { provider: "openrouter", model: "m2:free" }],
});
const collect = async (d: Deps): Promise<ResearchEvent[]> => {
  const out: ResearchEvent[] = [];
  for await (const e of research("q?", undefined, d)) out.push(e);
  return out;
};

describe("research", () => {
  it("streams sources, reasoning, answer and a done event with the cited numbers", async () => {
    const open = (async (_p, model) => ok(model, sse({ reasoning: "think" }, { content: "Yes [1]" }, { content: " and [2]." }))) as typeof openChat;
    const ev = await collect(base(open));
    expect(ev.find((e) => e.kind === "sources")).toMatchObject({ sources: [{ n: 1, host: "a.example" }, { n: 2, host: "b.example" }] });
    expect(ev.filter((e) => e.kind === "reasoning")).toEqual([{ kind: "reasoning", delta: "think" }]);
    expect(ev.filter((e) => e.kind === "answer").map((e) => (e as { delta: string }).delta).join("")).toBe("Yes [1] and [2].");
    expect(ev.at(-1)).toMatchObject({ kind: "done", used: [1, 2], model: "m1" });
  });
  it("falls back to the next free model when the first is rate limited", async () => {
    const open = (async (_p, model) => (model === "m1" ? bad("groq http 429") : ok(model, sse({ content: "ok [1]" })))) as typeof openChat;
    const ev = await collect(base(open));
    expect(ev.find((e) => e.kind === "step" && e.id === "model-0" && e.state === "error")).toMatchObject({ detail: "groq http 429" });
    expect(ev.at(-1)).toMatchObject({ kind: "done", model: "m2:free" });
  });
  it("falls back when a stream errors before any content", async () => {
    const open = (async (_p, model) => ok(model, model === "m1" ? sse({ content: "" }) + `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n` : sse({ content: "fine [2]" }))) as typeof openChat;
    expect((await collect(base(open))).at(-1)).toMatchObject({ kind: "done", model: "m2:free" });
  });
  it("still answers when one search vendor is down, and says which", async () => {
    const d = base((async (_p, model) => ok(model, sse({ content: "a [1]" }))) as typeof openChat);
    d.searchers[1].run = async () => bad("exa http 429");
    const ev = await collect(d);
    expect(ev.find((e) => e.kind === "step" && e.id === "search-exa" && e.state === "error")).toMatchObject({ detail: "exa http 429" });
    expect(ev.find((e) => e.kind === "sources")).toMatchObject({ sources: [{ n: 1 }] });
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("errors honestly when there are no web results or every model fails", async () => {
    const none = base((async () => bad("x")) as typeof openChat);
    none.searchers.forEach((s) => (s.run = async () => bad(`${s.id} off`)));
    expect((await collect(none)).at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("tavily off") });
    expect((await collect(base((async () => bad("down")) as typeof openChat))).at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("free model") });
  });
});
