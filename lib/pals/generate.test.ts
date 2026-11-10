import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import { fallbackQueries, generateRivals, pagesFrom, parsePlan, parseRivals, rivalMessages, type GenDeps, type GenResult, type GenStep } from "./generate";

const NOW = 5_000;
const src = (url: string, snippet: string, provider: "tavily" | "exa" = "tavily", publishedDate: string | null = null): WebSource => ({ url, title: url, snippet, publishedDate, provider, score: null });
const A = src("https://forum.example.com/relist", "Acme Escrow buyers report the seller re-listed the item under a new id after approval.");
const B = src("https://blog.example.org/fraud", "Acme Escrow also saw partial delivery fraud rising this year.", "exa");

const rivalJson = (quote: string, over: object = {}) => JSON.stringify({
  rivals: [{
    archetype: "counterparty", thesisOwner: "Acme Escrow", failureClass: "relist after approval", attack: "relist_new_id",
    counter: { capability: "Void", docUrl: "https://developer.paypal.com/docs/api/orders/v2/" },
    sources: [
      { url: A.url, operator: "tavily", fetchedAtMs: NOW, quote },
      { url: B.url, operator: "exa", fetchedAtMs: NOW, quote: "partial delivery fraud rising" },
    ],
    ...over,
  }],
});

const mk = (replies: (string | null)[], searchOk = true): GenDeps & { asked: string[] } => {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    now: () => NOW,
    ask: async (m) => { asked.push(m.map((x) => x.content).join("\n")); return replies[Math.min(i++, replies.length - 1)]; },
    search: [
      { id: "tavily", run: async () => (searchOk ? { ok: true as const, data: [A] } : { ok: false as const, degraded: true as const, reason: "tavily off" }) },
      { id: "exa", run: async () => (searchOk ? { ok: true as const, data: [B] } : { ok: false as const, degraded: true as const, reason: "exa off" }) },
    ],
  };
};

async function drain(g: AsyncGenerator<GenStep, GenResult>) {
  const steps: GenStep[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { steps, out: n.value };
    steps.push(n.value);
  }
}

describe("pure helpers", () => {
  it("parsePlan keeps sane queries from messy replies, and drops the rest", () => {
    const reply = `sure! ${JSON.stringify({ queries: ["escrow scam stories", "x", "a".repeat(200), " refund chargeback disputes ", 5] })}`;
    expect(parsePlan(reply)).toEqual(["escrow scam stories", "refund chargeback disputes"]);
    expect(parsePlan("no json")).toEqual([]);
    expect(parsePlan('{"queries":"nope"}')).toEqual([]);
  });
  it("fallbackQueries are bounded and non-empty", () => {
    expect(fallbackQueries("x ".repeat(200)).every((q) => q.length < 120)).toBe(true);
  });
  it("pagesFrom stamps the fetcher's time and operator, dedupes, and reads publish dates", () => {
    const p = pagesFrom([{ id: "tavily", data: [src("https://a.example.com/x?utm_source=1", "t", "tavily", "2026-01-02")] }, { id: "exa", data: [src("https://a.example.com/x", "other"), B] }], NOW);
    expect(p.map((x) => [x.operator, x.fetchedAtMs])).toEqual([["tavily", NOW], ["exa", NOW]]);
    expect(p[0].publishedMs).toBe(Date.parse("2026-01-02"));
  });
  it("parseRivals tolerates junk and rivalMessages carries the page headers and any repair notes", () => {
    expect(parseRivals("oops")).toEqual([]);
    const m = rivalMessages("deal", pagesFrom([{ id: "tavily", data: [A] }], NOW), ["quote is not in the fetched text"]);
    expect(m[1].content).toContain(`fetchedAtMs=${NOW}`);
    expect(m[1].content).toContain("quote is not in the fetched text");
  });
});

describe("generateRivals", () => {
  const good = rivalJson("re-listed the item under a new id");
  it("keeps a fully cited rival, with confidence from independent domains", async () => {
    const { out, steps } = await drain(generateRivals("pay a designer for a logo", mk(['{"queries":["logo designer scam stories"]}', good])));
    expect(out.error).toBeUndefined();
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ domains: 2, stale: false, confidence: "medium" });
    expect(steps.at(-1)).toMatchObject({ id: "rivals", state: "ok", detail: "1 kept, 0 rejected" });
  });
  it("rejects an invented quote, tells the model why, and accepts the repaired answer", async () => {
    const d = mk(["{}", rivalJson("the seller promised a full refund"), good]);
    const { out } = await drain(generateRivals("deal", d));
    expect(out.entries).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(d.asked.at(-1)).toContain("quote is not in the fetched text");
  });
  it("repairs when only one rival survived and others were rejected, merging without duplicates", async () => {
    const two = JSON.stringify({ rivals: [JSON.parse(good).rivals[0], { ...JSON.parse(good).rivals[0], archetype: "evidence", failureClass: "invented", sources: [{ url: A.url, operator: "tavily", fetchedAtMs: NOW, quote: "words nobody wrote anywhere" }] }] });
    const d = mk(["{}", two, good]);
    const { out } = await drain(generateRivals("deal", d));
    expect(out.entries).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(d.asked.at(-1)).toContain("quote is not in the fetched text");
  });
  it("gives up honestly when nothing survives, and never invents a rival", async () => {
    const { out } = await drain(generateRivals("deal", mk(["{}", rivalJson("totally made up words here")])));
    expect(out.entries).toEqual([]);
    expect(out.error).toBe("no rival survived cite-or-die");
  });
  it("stops at a search outage: no pages, no rivals, an error that says so", async () => {
    const { out, steps } = await drain(generateRivals("deal", mk(["{}"], false)));
    expect(out.error).toContain("no web results");
    expect(steps.at(-1)).toMatchObject({ id: "search", state: "error" });
  });
  it("survives every model failing (fallback queries, then no rivals)", async () => {
    const { out } = await drain(generateRivals("deal", mk([null])));
    expect(out.queries).toEqual(fallbackQueries("deal"));
    expect(out.error).toBe("every model failed; no rivals proposed");
  });
  it("a one-domain rival is low confidence", async () => {
    const one = rivalJson("re-listed the item under a new id", { sources: [{ url: A.url, operator: "tavily", fetchedAtMs: NOW, quote: "re-listed the item under a new id" }] });
    const { out } = await drain(generateRivals("deal", mk(["{}", one])));
    expect(out.entries[0].confidence).toBe("low");
  });
});
