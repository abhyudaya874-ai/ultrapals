import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import { SUPER_PALS, scoreSuperPals } from "@/lib/pals/superpals";
import { collect, mkDeps, mkSession, ok, scripted } from "./fakes";
import { disclosureRows } from "./process";
import { applyCEvent, newRun } from "./run";
import { runSuperPals } from "./superpal-agent";

const page = (text: string): WebSource => ({ url: "https://docs.example.com/p", title: "t", snippet: text, publishedDate: null, provider: "tavily", score: null });
const rows = () => scoreSuperPals({});
const ctx = (searchRun: (q: string) => Promise<unknown>) =>
  ({ agent: "rival-1", session: mkSession(), deps: mkDeps(scripted(["x"]).open, { search: [{ id: "tavily", label: "Tavily", run: searchRun as never }, { id: "exa", label: "Exa", run: searchRun as never }] as never }) });

describe("runSuperPals", () => {
  it("gives every SuperPal its own ResearchPal: RivalPal -> SuperPal -> ResearchPal, each hop admitted", async () => {
    const { ev } = await collect(runSuperPals(ctx(async () => ok([page("Stripe, Shopify, Apple Pay, Adyen, Wise, Klarna, Coinbase x402 and Square all publish sandbox docs for developers.")])), rows()));
    const agents = ev.filter((e) => e.kind === "agent");
    const ids = (role: string, parent: (p: string) => boolean) => new Set(agents.flatMap((e) => (e.kind === "agent" && e.role === role && e.parent && parent(e.parent) ? [e.id] : [])));
    expect(ids("superpal", (p) => p === "rival-1").size).toBe(8);
    expect(ids("research", (p) => p.startsWith("superpal-")).size).toBe(8);
    expect(ev.filter((e) => e.kind === "spawn" && e.decision === "denied")).toEqual([]);
    expect(ev.filter((e) => e.kind === "spawn")).toHaveLength(16);
  });
  it("attaches a verbatim, cited line where a page names the rival, and changes no status", async () => {
    const before = rows();
    const { ret } = await collect(runSuperPals(ctx(async () => ok([page("Wise shows the exact fee and rate in a quote before you send money, every time.")])), before));
    const wise = ret.find((r) => r.pal.id === "wise")!;
    expect(wise.evidence?.quote).toContain("Wise");
    expect("Wise shows the exact fee and rate in a quote before you send money, every time.".includes(wise.evidence!.quote)).toBe(true);
    expect(ret.map((r) => r.status)).toEqual(before.map((r) => r.status));
    expect(ret.find((r) => r.pal.id === "stripe")!.evidence).toBeUndefined();
  });
  it("a failing search is a red step on that worker only; the others still finish", async () => {
    let n = 0;
    const { ev, ret } = await collect(runSuperPals(ctx(async () => (++n % 2 ? { ok: false, degraded: true, reason: "tavily off" } : ok([page("Klarna lets buyers split the price at checkout in four parts.")]))), rows()));
    expect(ev.some((e) => e.kind === "step" && e.state === "error")).toBe(true);
    expect(ret).toHaveLength(8);
  });
  it("a search that throws does not crash the run", async () => {
    const { ret } = await collect(runSuperPals(ctx(async () => { throw new Error("boom"); }), rows()));
    expect(ret.every((r) => r.evidence === undefined)).toBe(true);
  });
  it("no search adapters: returns the rows untouched and emits nothing", async () => {
    const c = { agent: "rival-1", session: mkSession(), deps: mkDeps(scripted(["x"]).open) };
    const { ev, ret } = await collect(runSuperPals(c, rows()));
    expect(ev).toEqual([]);
    expect(ret).toEqual(rows());
  });
  it("the reducer shows the chain as indented rows with the messages between them", async () => {
    const { ev } = await collect(runSuperPals(ctx(async () => ok([page("Square sellers take orders inside ChatGPT and Claude today.")])), rows()));
    const run = ev.reduce(applyCEvent, newRun("r", "x"));
    const depths = disclosureRows(run).map((r) => r.depth);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
    expect(run.messages.filter((m) => m.from === "rival-1")).toHaveLength(8);
    expect(run.messages.filter((m) => m.to === "rival-1")).toHaveLength(8);
    expect(SUPER_PALS).toHaveLength(8);
  });
});
