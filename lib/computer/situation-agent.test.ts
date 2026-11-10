import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import type { ProbeRow } from "@/lib/pals/probe";
import { collect, mkDeps, mkSession, ok, scripted } from "./fakes";
import { runSituationAgent } from "./situation-agent";
import { applyCEvent, newRun } from "./run";

const TEXT = "Stripe handles refunds and disputes with a Dashboard and API. Square also supports refunds and takes payments in person. PayPal offers dispute resolution for sellers.";
const PAGE: WebSource = { url: "https://docs.example.com/payments", title: "t", snippet: TEXT, publishedDate: null, provider: "tavily", score: null };
const search = [{ id: "tavily", label: "Tavily", run: async () => ok([PAGE]) }, { id: "exa", label: "Exa", run: async () => ok([PAGE]) }];
const NEEDS = JSON.stringify({ needs: [{ need: "refunds_and_disputes", weight: 4, why: "buyers will ask" }, { need: "in_person", weight: 1, why: "pop-ups" }] });
const cellsFor = (quote: string) => JSON.stringify({ cells: [{ rail: "stripe", need: "refunds_and_disputes", support: "yes", url: PAGE.url, quote }, { rail: "square", need: "in_person", support: "yes", url: PAGE.url, quote: "takes payments in person" }] });
const row = (rail: ProbeRow["rail"]): ProbeRow[] => [{ rail, check: "typed_error", outcome: "pass", detail: "ok" }];
const probes = { stripe: async () => ok(row("stripe")), square: async () => ok(row("square")), paypal: async () => ok(row("paypal")) };
const ctx = (replies: string[], patch: object = {}) => ({ agent: "situation-1", session: mkSession(), deps: mkDeps(scripted(replies).open, { search: search as never, probes: probes as never, ...patch }) });

describe("SituationPal", () => {
  it("gives every rail its own Pal, researches in rounds, runs sandbox checks and returns a ranked card", async () => {
    const { ev, ret } = await collect(runSituationAgent(ctx([NEEDS, cellsFor("refunds and disputes with a Dashboard and API")]), "a shop selling prints at pop-ups and online"));
    const pals = new Set(ev.flatMap((e) => (e.kind === "agent" && e.role === "superpal" ? [e.id] : [])));
    expect(pals.size).toBe(9);
    expect(new Set(ev.flatMap((e) => (e.kind === "agent" && e.role === "sandbox" ? [e.id] : [])))).toEqual(new Set(["sandbox-stripe", "sandbox-square", "sandbox-paypal"]));
    const card = ev.find((e) => e.kind === "situation");
    expect(card?.kind === "situation" && card.card.rails[0].rail).toBe("stripe");
    expect(card?.kind === "situation" && card.card.probes).toHaveLength(3);
    expect(ret).toContain("not a forecast");
    const run = ev.reduce(applyCEvent, newRun("r", "x"));
    expect(run.situation?.rails.length).toBe(9);
    expect(run.messages.filter((m) => m.to === "situation-1")).toHaveLength(9);
  });
  it("chains rounds while answers are missing and says why it stopped", async () => {
    const { ev } = await collect(runSituationAgent(ctx([NEEDS, cellsFor("refunds and disputes with a Dashboard and API")]), "a shop"));
    const card = ev.find((e) => e.kind === "situation");
    expect(card?.kind === "situation" && card.card.rounds).toBeGreaterThanOrEqual(1);
    if (card?.kind !== "situation") throw new Error("no situation card");
    expect(["max_rounds", "no_progress", "search_budget", "complete"]).toContain(card.card.stop);
    expect(card.card.unknown).toBeGreaterThan(0); // 9 rails x 2 needs, only 2 cited: the card does not pretend
  });
  it("cite or die: an invented quote produces no cell", async () => {
    const { ev } = await collect(runSituationAgent(ctx([NEEDS, cellsFor("Stripe guarantees every dispute is won instantly")]), "a shop"));
    const card = ev.find((e) => e.kind === "situation");
    expect(card?.kind === "situation" && card.card.cells.find((c) => c.rail === "stripe")).toBeUndefined();
  });
  it("without search adapters it still runs the sandbox checks and reports stop=no_search", async () => {
    const { ev } = await collect(runSituationAgent(ctx([NEEDS], { search: [] }), "a shop"));
    const card = ev.find((e) => e.kind === "situation");
    expect(card?.kind === "situation" && card.card.stop).toBe("no_search");
    expect(card?.kind === "situation" && card.card.probes).toHaveLength(3);
    expect(card?.kind === "situation" && card.card.rails.every((r) => r.fit === 0 && r.upper === 1)).toBe(true);
  });
  it("when no model can read the idea it falls back to default needs and says so", async () => {
    const dead = { agent: "situation-1", session: mkSession(), deps: mkDeps((async () => ({ ok: false, degraded: true, reason: "down" })) as never, { search: [] as never, probes: probes as never }) };
    const { ev, ret } = await collect(runSituationAgent(dead, "a shop"));
    const card = ev.find((e) => e.kind === "situation");
    expect(card?.kind === "situation" && card.card.needsDefaulted).toBe(true);
    expect(ret).toContain("defaulted");
  });
  it("a failing probe or search never crashes the run", async () => {
    const boom = { id: "tavily", label: "Tavily", run: async () => { throw new Error("boom"); } };
    const { ev } = await collect(runSituationAgent(ctx([NEEDS], { search: [boom] as never, probes: { ...probes, stripe: async () => ({ ok: false, degraded: true, reason: "stripe off" }) } as never }), "a shop"));
    expect(ev.some((e) => e.kind === "situation")).toBe(true);
    expect(ev.some((e) => e.kind === "step" && e.state === "error")).toBe(true);
  });
  it("holds no PayPal write tool: the paypal probe receives only the last promise run", async () => {
    let got: unknown = "unset";
    const c = ctx([NEEDS], { search: [], probes: { ...probes, paypal: async (run: unknown) => { got = run; return ok(row("paypal")); } } });
    c.session.lastPromiseRun = { promiseId: "p", approved: true, settled: true, state: "captured", orderStatusAfter: "COMPLETED", moneyOpsCarriedId: true, currency: "USD" };
    await collect(runSituationAgent(c, "a shop"));
    expect(got).toMatchObject({ promiseId: "p" });
  });
});
