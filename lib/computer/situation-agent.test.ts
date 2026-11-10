import { describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import type { WebSource } from "@/lib/integrations/types";
import type { ProbeRow } from "@/lib/pals/probe";
import { cardHash, receiptId } from "@/lib/pals/receipt";
import { judgeRecommendation } from "@/lib/pals/recommend";
import { collect, mkDeps, mkSession, ok, stream } from "./fakes";
import { applyCEvent, newRun } from "./run";
import { runSituationAgent } from "./situation-agent";

const TEXT = "Stripe, Square, PayPal, Adyen, Wise, Klarna, Shopify, Apple Pay and Coinbase all publish payments docs. Lemon Squeezy acts as merchant of record and handles tax for digital goods. Razorpay is popular in India.";
const PAGE: WebSource = { url: "https://docs.example.com/payments", title: "t", snippet: TEXT, publishedDate: null, provider: "tavily", score: null };
const search = [{ id: "tavily", label: "Tavily", run: async () => ok([PAGE]) }, { id: "exa", label: "Exa", run: async () => ok([PAGE]) }];
const row = (rail: ProbeRow["rail"], outcome: ProbeRow["outcome"] = "pass"): ProbeRow[] => [{ rail, check: "typed_error", outcome, detail: "ok" }];
const probes = { stripe: async () => ok(row("stripe")), square: async () => ok(row("square")), paypal: async () => ok(row("paypal")) };

const sse = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
/** A fake model that answers by what the system prompt asks for, and records which model (family) answered which job. */
function brain(o: { pick?: string; stripeWins?: boolean; dead?: boolean } = {}) {
  const seen: { job: string; model: string }[] = [];
  const open = (async (provider: "groq", model: string, messages: { content: string }[]) => {
    if (o.dead) return { ok: false as const, degraded: true as const, reason: "down" };
    const sys = messages[0].content;
    const user = messages[1]?.content ?? "";
    let job = "?";
    let reply = "{}";
    if (sys.includes("Choose the 3 to 6 payment needs")) { job = "needs"; reply = JSON.stringify({ needs: [{ need: "refunds_and_disputes", weight: 4, why: "" }, { need: "cross_border_fx", weight: 1, why: "" }] }); }
    else if (sys.includes("surface payment providers")) { job = "scoutplan"; reply = JSON.stringify({ queries: ["payment providers for digital goods in india"] }); }
    else if (sys.includes("find payment providers that fit")) { job = "scout"; reply = JSON.stringify({ rails: [{ name: "Lemon Squeezy", why: "merchant of record", url: PAGE.url, quote: "Lemon Squeezy acts as merchant of record and handles tax" }] }); }
    else if (sys.includes("classify what payment rails support")) {
      job = "classify";
      const wanted = /CELLS WANTED \(rail\/need\): (.*)/.exec(user)?.[1] ?? "";
      const cells = wanted.split(", ").filter(Boolean).map((t) => t.split("/")).map(([rail, need]) => ({ rail, need, support: o.stripeWins === false ? "partial" : rail === "stripe" ? "yes" : "no", url: PAGE.url, quote: rail === "lemon-squeezy" ? "Lemon Squeezy acts as merchant of record" : "publish payments docs" }));
      reply = JSON.stringify({ cells: cells.map((c) => (c.rail === "stripe" || c.rail === "lemon-squeezy" ? c : { ...c, quote: "publish payments docs" })) });
    }
    else if (sys.includes("independent reviewer")) { job = "blind"; reply = JSON.stringify({ pick: o.pick ?? "stripe", concern: "fees" }); }
    seen.push({ job, model });
    return { ok: true as const, data: { provider, model, body: stream(sse(reply)) } };
  }) as unknown as typeof openChat;
  return { open, seen };
}
const TWO_FAMILIES = [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }, { provider: "nvidia" as const, model: "nvidia/nemotron-3.5-lightning-30b-a3b" }];
const ctx = (b: ReturnType<typeof brain>, patch: object = {}, models = TWO_FAMILIES) => ({ agent: "situation-1", session: mkSession(), deps: mkDeps(b.open, { search: search as never, probes: probes as never, model: { models, open: b.open, now: () => 1000 } as never, ...patch }) });
const card = (ev: Awaited<ReturnType<typeof collect>>["ev"]) => {
  const c = ev.find((e) => e.kind === "situation");
  if (!c || c.kind !== "situation") throw new Error("no situation card");
  return c.card;
};

describe("SituationPal as a Case Desk", () => {
  it("finds rails the seeds do not have (Lemon Squeezy), each cited, and gives each its own Pal", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain()), "digital reports sold worldwide, with tax handled"));
    const c = card(ev);
    expect(c.discovered).toEqual([expect.objectContaining({ id: "lemon-squeezy", name: "Lemon Squeezy", url: PAGE.url })]);
    expect(c.rails.some((r) => r.rail === "lemon-squeezy")).toBe(true);
    const pals = new Set(ev.flatMap((e) => (e.kind === "agent" && e.role === "superpal" ? [e.id] : [])));
    expect(pals.has("superpal-lemon-squeezy")).toBe(true);
    expect(pals.has("superpal-scout")).toBe(true);
  });
  it("keeps researching and eliminating losers until one rail beats every other's best case, then stops", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain()), "a shop"));
    const c = card(ev);
    expect(c.stop).toBe("best_found");
    expect(c.rails[0].rail).toBe("stripe");
    expect(c.rubric).toMatchObject({ outcome: "APPROVE", reasons: ["SEPARATED"], leader: "stripe", contenders: ["stripe"] });
    const run = ev.reduce(applyCEvent, newRun("r", "x"));
    expect(run.situation?.rubric?.outcome).toBe("APPROVE");
  });
  it("T24: the blind reader is a DIFFERENT model family from the classifier, and sees the grid only", async () => {
    const b = brain();
    const { ev } = await collect(runSituationAgent(ctx(b), "a shop"));
    const c = card(ev);
    const classifierModels = new Set(b.seen.filter((s) => s.job !== "blind").map((s) => s.model.split("/")[0]));
    const blindModel = b.seen.find((s) => s.job === "blind")!.model.split("/")[0];
    expect(classifierModels.has(blindModel)).toBe(false);
    expect(c.blind?.family).toBe(blindModel);
  });
  it("a blind reader that picks an eliminated rail raises the case to FLAG", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain({ pick: "paypal" })), "a shop"));
    expect(card(ev).rubric).toMatchObject({ outcome: "FLAG", reasons: ["BLIND_DISAGREES"] });
  });
  it("only one model family reachable: unknown stays HOLD, never APPROVE", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain(), {}, [TWO_FAMILIES[0]]), "a shop"));
    const c = card(ev);
    expect(c.blind).toBeUndefined();
    expect(c.rubric).toMatchObject({ outcome: "HOLD", reasons: ["BLIND_UNAVAILABLE"] });
  });
  it("when answers stay unclear the band overlaps: HOLD, with the unknowns counted", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain({ stripeWins: false })), "a shop"));
    const c = card(ev);
    expect(c.rubric?.outcome).toBe("HOLD");
    expect(c.rubric?.reasons).toContain("BAND_OVERLAP");
  });
  it("the receipt covers the evidence, the rubric and the blind result, and replays to the same outcome", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain()), "a shop"));
    const c = card(ev);
    const round = JSON.parse(JSON.stringify(c));
    expect(judgeRecommendation(round, round.blind ?? null)).toEqual(round.rubric);
    expect(receiptId(round)).toBe(c.receipt!.id);
    expect(cardHash(round)).toBe(c.receipt!.cardHash);
    expect(receiptId({ ...round, blind: { ...round.blind, pick: "paypal" } })).not.toBe(c.receipt!.id);
  });
  it("no search adapters: sandbox checks still run, the stop reason says why, and nothing is approved", async () => {
    const { ev } = await collect(runSituationAgent(ctx(brain(), { search: [] }), "a shop"));
    const c = card(ev);
    expect(c.stop).toBe("no_search");
    expect(c.probes).toHaveLength(3);
    expect(c.rubric?.outcome).not.toBe("APPROVE");
  });
  it("no model can read anything: default needs, flagged, never approved", async () => {
    const { ev, ret } = await collect(runSituationAgent(ctx(brain({ dead: true }), { search: [] }), "a shop"));
    expect(card(ev).needsDefaulted).toBe(true);
    expect(card(ev).rubric?.outcome).toBe("HOLD");
    expect(ret).toContain("defaulted");
  });
  it("a failing probe or search never crashes the run", async () => {
    const boom = { id: "tavily", label: "Tavily", run: async () => { throw new Error("boom"); } };
    const { ev } = await collect(runSituationAgent(ctx(brain(), { search: [boom], probes: { ...probes, stripe: async () => ({ ok: false, degraded: true, reason: "stripe off" }) } }), "a shop"));
    expect(ev.some((e) => e.kind === "situation")).toBe(true);
    expect(ev.some((e) => e.kind === "step" && e.state === "error")).toBe(true);
  });
  it("holds no PayPal write tool: the paypal probe receives only the last promise run", async () => {
    let got: unknown = "unset";
    const c = ctx(brain(), { search: [], probes: { ...probes, paypal: async (run: unknown) => { got = run; return ok(row("paypal")); } } });
    c.session.lastPromiseRun = { promiseId: "p", approved: true, settled: true, state: "captured", orderStatusAfter: "COMPLETED", moneyOpsCarriedId: true, currency: "USD" };
    await collect(runSituationAgent(c, "a shop"));
    expect(got).toMatchObject({ promiseId: "p" });
  });
});
