import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import { collect, mkDeps, mkSession, ok, scripted } from "./fakes";
import { runRivalAgent } from "./rival-agent";
import { parseMainAction } from "./main-actions";
import { applyCEvent, newRun } from "./run";

const NOW = 7_000_000;
const A: WebSource = { url: "https://forum.example.com/relist", title: "t", snippet: "Acme Escrow buyers say the seller re-listed the item under a new id after approval.", publishedDate: null, provider: "tavily", score: null };
const B: WebSource = { url: "https://blog.example.org/fraud", title: "t", snippet: "Acme Escrow also saw partial delivery fraud rising.", publishedDate: null, provider: "exa", score: null };
const rivals = JSON.stringify({
  rivals: [{
    archetype: "counterparty", thesisOwner: "Acme Escrow", failureClass: "relist after approval", attack: "relist_new_id",
    counter: { capability: "Void", docUrl: "https://developer.paypal.com/docs/api/orders/v2/" },
    sources: [
      { url: A.url, operator: "tavily", fetchedAtMs: NOW, quote: "re-listed the item under a new id" },
      { url: B.url, operator: "exa", fetchedAtMs: NOW, quote: "partial delivery fraud rising" },
    ],
  }],
});
const search = (okSearch: boolean) => [
  { id: "tavily", label: "Tavily", run: async () => (okSearch ? ok([A]) : { ok: false as const, degraded: true as const, reason: "tavily off" }) },
  { id: "exa", label: "Exa", run: async () => (okSearch ? ok([B]) : { ok: false as const, degraded: true as const, reason: "exa off" }) },
];

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("RivalPal", () => {
  it("researches, spawns cited rivals, attacks the real judge and emits a ladder the reducer keeps", async () => {
    const m = scripted(['{"queries":["logo designer scam stories"]}', rivals]);
    const { ev, ret } = await collect(runRivalAgent({ agent: "rival-1", session: mkSession(), deps: mkDeps(m.open, { search: search(true) as never }) }, "Pay a designer $40 when the final logo is live"));
    expect(ev.filter((e) => e.kind === "step" && e.agent === "rival-1").map((e) => e.kind === "step" && `${e.id}:${e.state}`)).toEqual(
      ["plan:running", "plan:ok", "search:running", "search:ok", "rivals:running", "rivals:ok", "exam:running", "exam:ok"],
    );
    const ladder = ev.find((e) => e.kind === "ladder");
    expect(ladder?.kind === "ladder" && ladder.card).toMatchObject({ seal: { seal: "SEALED" }, rivals: [{ confidence: "medium" }] });
    expect(ret).toContain("Exam result: SEALED");
    const run = ev.reduce(applyCEvent, newRun("r", "x"));
    expect(run.exam?.seal.seal).toBe("SEALED");
  });
  it("says so plainly when search is down: no ladder, no claim the deal was examined", async () => {
    const m = scripted(["{}"]);
    const { ev, ret } = await collect(runRivalAgent({ agent: "rival-1", session: mkSession(), deps: mkDeps(m.open, { search: search(false) as never }) }, "a deal"));
    expect(ev.some((e) => e.kind === "ladder")).toBe(false);
    expect(ret).toContain("Rival exam could not run");
    expect(ret).toContain("Do not claim the deal was examined");
  });
  it("is a delegate target for the main agent", () => {
    expect(parseMainAction('{"action":"delegate","agent":"rival","task":"examine this deal"}').ok).toBe(true);
  });
});
