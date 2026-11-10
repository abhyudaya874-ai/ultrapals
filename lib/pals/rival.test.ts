import { describe, expect, it } from "vitest";
import { dedupeRivals, verifyRival, type FetchedPage, type Rival } from "./rival";

const NOW = 2_000_000_000_000;
const PAGE: FetchedPage = { url: "https://forum.example.com/t/relist?utm_source=x", text: "Seller   re-listed the item under a NEW id after the buyer approved.", fetchedAtMs: NOW - 1000 };
const PAGE2: FetchedPage = { url: "https://news.example.org/a", text: "Escrow Co says partial delivery fraud is rising.", fetchedAtMs: NOW - 500 };
const FETCHED = [PAGE, PAGE2];

const rival = (over: Partial<Rival> = {}): Rival => ({
  archetype: "counterparty",
  thesisOwner: "Escrow Co",
  failureClass: "relist after approval",
  attack: "relist_new_id",
  counter: { capability: "Void", docUrl: "https://developer.paypal.com/docs/api/orders/v2/" },
  sources: [
    { url: "https://forum.example.com/t/relist", operator: "tavily", fetchedAtMs: PAGE.fetchedAtMs, quote: "re-listed the item under a new id" },
    { url: "https://news.example.org/a", operator: "exa", fetchedAtMs: PAGE2.fetchedAtMs, quote: "partial delivery fraud is rising" },
  ],
  ...over,
});

const ROWS: [string, Partial<Rival>, string | null][] = [
  ["a fully cited rival passes", {}, null],
  ["a quote that is not in the page dies", { sources: [{ ...rival().sources[0], quote: "the seller promised a full refund" }] }, "quote is not in the fetched text"],
  ["a source nobody fetched dies", { sources: [{ ...rival().sources[0], url: "https://never.example.net/x" }] }, "was never fetched"],
  ["a model-written timestamp dies", { sources: [{ ...rival().sources[0], fetchedAtMs: PAGE.fetchedAtMs + 1 }] }, "not the fetcher's stamp"],
  ["a counter outside PayPal docs dies", { counter: { capability: "Void", docUrl: "https://blog.example.com/paypal" } }, "counter.docUrl"],
  ["an http counter dies", { counter: { capability: "Void", docUrl: "http://developer.paypal.com/x" } }, "counter.docUrl"],
  ["an invented PayPal capability dies", { counter: { capability: "Escrow" as never, docUrl: "https://developer.paypal.com/x" } }, "counter.capability"],
  ["a thesis owner that appears nowhere dies", { thesisOwner: "Totally Unrelated Inc" }, "appears in no source"],
  ["no sources dies", { sources: [] }, "sources"],
  ["an unknown attack dies", { attack: "make_it_rain" as never }, "attack"],
];

describe("verifyRival (cite or die)", () => {
  it.each(ROWS)("%s", (_name, over, errorPart) => {
    const r = verifyRival(rival(over), FETCHED, NOW);
    if (errorPart === null) expect(r).toEqual({ ok: true, domains: 2, stale: false });
    else {
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.errors.join(";")).toContain(errorPart);
    }
  });
  it("matches quotes through whitespace and case, and tracking params in the url", () => {
    const [first, second] = rival().sources;
    expect(verifyRival(rival({ sources: [{ ...first, quote: "SELLER re-listed THE item" }, second] }), FETCHED, NOW).ok).toBe(true);
  });
  it("rejects a source whose operator is not the one that fetched it", () => {
    const r = verifyRival(rival(), [{ ...PAGE, operator: "exa" }, PAGE2], NOW);
    expect(r.ok === false && r.errors.join(";")).toContain("operator is tavily but exa fetched it");
  });
  it("flags sources older than 18 months as stale without rejecting them", () => {
    const old = [{ ...PAGE, publishedMs: NOW - 19 * 30 * 86_400_000 }, PAGE2];
    expect(verifyRival(rival(), old, NOW)).toEqual({ ok: true, domains: 2, stale: true });
  });
  it("rejects a page fetched in the future", () => {
    expect(verifyRival(rival(), FETCHED, PAGE.fetchedAtMs - 1).ok).toBe(false);
  });
  it("never throws on junk", () => {
    expect(verifyRival(null, FETCHED, NOW).ok).toBe(false);
    expect(verifyRival("x", [], NOW).ok).toBe(false);
  });
});

describe("dedupeRivals", () => {
  const other = (archetype: Rival["archetype"], failureClass: string, url: string): Rival =>
    rival({ archetype, failureClass, sources: [{ url, operator: "exa", fetchedAtMs: 1, quote: "some quote here" }] });
  it("keeps the first of a same-archetype same-class pair, ignoring case and punctuation", () => {
    const a = other("evidence", "Placeholder asset swap", "https://a.example.com/1");
    const b = other("evidence", "placeholder asset swap!", "https://b.example.com/2");
    expect(dedupeRivals([a, b])).toEqual([a]);
  });
  it("kills a same-archetype rival that shares a source domain, but not a different archetype", () => {
    const a = other("evidence", "class one", "https://same.example.com/1");
    const b = other("evidence", "class two", "https://same.example.com/2");
    const c = other("cost", "class three", "https://same.example.com/3");
    expect(dedupeRivals([a, b, c])).toEqual([a, c]);
  });
  it("caps the panel", () => {
    const many = Array.from({ length: 9 }, (_, i) => other("evidence", `class ${i}`, `https://d${i}.example.com/x`));
    expect(dedupeRivals(many).length).toBe(6);
    expect(dedupeRivals(many, 2).length).toBe(2);
  });
});
