import { describe, expect, it } from "vitest";
import { buildCard, summarizeCard } from "./card";
import { runExam } from "./exam";
import type { GenResult } from "./generate";
import type { Rival } from "./rival";

const rival: Rival = {
  archetype: "evidence", attack: "placeholder_asset", thesisOwner: "Acme", failureClass: "placeholder swap",
  counter: { capability: "Disputes", docUrl: "https://developer.paypal.com/x" },
  sources: [{ url: "https://a.example.com/x", operator: "tavily", fetchedAtMs: 1, quote: "Acme says so" }],
};
const gen: GenResult = { queries: ["q"], pages: [], entries: [{ rival, domains: 1, stale: false, confidence: "low" }], rejected: [{ errors: ["x"] }] };

describe("exam card", () => {
  const card = buildCard("pay for a logo ".repeat(40), gen, runExam([rival]));
  it("carries counts and clips the contract", () => {
    expect(card).toMatchObject({ rejected: 1, pages: 0, queries: ["q"] });
    expect(card.contract.length).toBe(300);
    expect("archetypes" in card).toBe(false);
  });
  it("survives a JSON round trip unchanged (it crosses the SSE stream)", () => {
    expect(JSON.parse(JSON.stringify(card))).toEqual(card);
  });
  it("summary states the seal, every row, the attacks and the cited rival, and claims nothing unmeasured", () => {
    const t = summarizeCard(card);
    expect(t).toContain("Exam result: CONDITIONAL");
    expect(t).toContain("- counterparty: BAR_MET (observed 0, bar <= 0, measured)");
    expect(t).toContain("- evidence: NOT_MEASURABLE");
    expect(t).toContain("Attacks on the judge: 10/10 survived; 2 guarded elsewhere.");
    expect(t).toContain("Rival (evidence, low confidence): placeholder swap per Acme; counter Disputes. Sources: https://a.example.com/x");
    expect(t).toContain("Live conditions the program must hold at runtime: evidence.");
  });
});
