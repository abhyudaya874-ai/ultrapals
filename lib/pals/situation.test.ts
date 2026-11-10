import { describe, expect, it } from "vitest";
import type { FetchedPage } from "./rival";
import { RAILS, buildSituationCard, mergeCells, mergeCellsDetail, parseCells, parseNeeds, parseRails, queriesFor, scoreRails, scoutQueries, summarizeSituation, unknownCells, verifyCells, verifyRails, type Cell, type Need, type RailDef } from "./situation";

const NEEDS: Need[] = [{ need: "refunds_and_disputes", weight: 4, why: "" }, { need: "cross_border_fx", weight: 1, why: "" }];
const defs = (...ids: string[]): RailDef[] => ids.map((id) => RAILS.find((r) => r.id === id) ?? { id, name: id, alias: [id] });
const page = (url: string, text: string): FetchedPage => ({ url, text, fetchedAtMs: 9, operator: "tavily" });
const cell = (rail: Cell["rail"], need: Cell["need"], support: Cell["support"]): Cell => ({ rail, need, support, url: "https://x.example.com", quote: "q quote text", fetchedAtMs: 1 });

describe("parseNeeds", () => {
  it("keeps only ids from the closed list, the heavier duplicate, and at most six", () => {
    const r = parseNeeds(`ok ${JSON.stringify({ needs: [{ need: "subscriptions", weight: 2 }, { need: "subscriptions", weight: 5 }, { need: "made_up", weight: 5 }, { need: "invoicing", weight: 9 }, { need: "micropayments", weight: 3, why: "tiny" }] })}`);
    expect(r.map((n) => [n.need, n.weight])).toEqual([["subscriptions", 5], ["micropayments", 3]]);
  });
  it("returns nothing for junk so the caller can default", () => {
    expect(parseNeeds("no json")).toEqual([]);
    expect(parseNeeds('{"needs":"x"}')).toEqual([]);
  });
});

describe("verifyCells (cite or die)", () => {
  const pages = new Map([["stripe" as const, [page("https://docs.stripe.com/a", "Stripe supports refunds and handles disputes through the Dashboard and API.")]]]);
  const good = { rail: "stripe", need: "refunds_and_disputes", support: "yes", url: "https://docs.stripe.com/a", quote: "refunds and handles disputes through the Dashboard" };
  const wanted = ["refunds_and_disputes" as const];
  it("keeps a verbatim, rail-named, wanted cell and stamps the fetcher's time and operator", () => {
    const r = verifyCells([good], pages, wanted);
    expect(r.kept[0]).toMatchObject({ rail: "stripe", support: "yes", fetchedAtMs: 9, operator: "tavily" });
  });
  it.each([
    ["an invented quote", { ...good, quote: "Stripe guarantees instant dispute wins always" }, "quote is not in the fetched text"],
    ["a url not fetched for this rail", { ...good, url: "https://elsewhere.example.com/x" }, "url was not fetched"],
    ["a need the idea did not ask about", { ...good, need: "stablecoin" }, "not a need of this idea"],
    ["a rail that is not in the comparison", { ...good, rail: "bitpay" }, "not a rail in this comparison"],
    ["a bad support value", { ...good, support: "maybe" }, "malformed"],
  ])("drops %s", (_n, c, why) => {
    const r = verifyCells([c], pages, wanted);
    expect(r.kept).toEqual([]);
    expect(r.dropped[0]).toContain(why);
  });
  it("drops a page that never names the rail", () => {
    const p = new Map([["wise" as const, [page("https://x.example.com/p", "A general page about sending money abroad cheaply.")]]]);
    expect(verifyCells([{ rail: "wise", need: "cross_border_fx", support: "yes", url: "https://x.example.com/p", quote: "sending money abroad cheaply" }], p, ["cross_border_fx"]).dropped[0]).toContain("never names");
  });
  it("parseCells tolerates junk", () => {
    expect(parseCells("nope")).toEqual([]);
    expect(parseCells('{"cells":[1,2]}')).toEqual([1, 2]);
  });
});

describe("scoreRails", () => {
  const cells = [cell("stripe", "refunds_and_disputes", "yes"), cell("stripe", "cross_border_fx", "partial"), cell("paypal", "refunds_and_disputes", "partial")];
  const r = scoreRails(defs("paypal", "stripe", "square"), NEEDS, cells);
  it("weights by the idea's needs and ranks by the conservative fit", () => {
    expect(r.map((x) => x.rail)).toEqual(["stripe", "paypal", "square"]);
    expect(r[0].fit).toBe(0.9); // (4*1 + 1*0.5) / 5
  });
  it("unknown is a band, never a zero verdict and never a pass", () => {
    const pp = r.find((x) => x.rail === "paypal")!;
    expect(pp.fit).toBe(0.4); // 4*0.5 / 5
    expect(pp.upper).toBe(0.6); // + the unknown fx weight 1/5
    expect(pp.known).toBe(0.8);
    const sq = r.find((x) => x.rail === "square")!;
    expect(sq).toMatchObject({ fit: 0, upper: 1, known: 0 });
  });
  it("is deterministic and does not mutate its input", () => {
    const snap = JSON.stringify(cells);
    expect(JSON.stringify(scoreRails(defs("paypal", "stripe", "square"), NEEDS, cells))).toBe(JSON.stringify(r));
    expect(JSON.stringify(cells)).toBe(snap);
  });
});

describe("the chain", () => {
  it("queriesFor makes ONE query per rail naming the three heaviest unknown needs", () => {
    expect(queriesFor(defs("stripe")[0], ["refunds_and_disputes", "cross_border_fx", "invoicing", "micropayments", "stablecoin"])).toHaveLength(1);
    expect(queriesFor(defs("stripe")[0], ["refunds_and_disputes", "cross_border_fx", "invoicing", "micropayments"])[0]).not.toContain("micropayments");
    expect(queriesFor(defs("wise")[0], [])).toEqual([]);
  });
  it("unknownCells lists the heaviest needs first and shrinks as cells arrive", () => {
    const u0 = unknownCells(["stripe"], NEEDS, []);
    expect(u0.map((x) => x.need)).toEqual(["refunds_and_disputes", "cross_border_fx"]);
    expect(unknownCells(["stripe"], NEEDS, [cell("stripe", "refunds_and_disputes", "yes")]).map((x) => x.need)).toEqual(["cross_border_fx"]);
  });
  it("mergeCells keeps the first answer for a pair and adds only new ones", () => {
    const a = cell("stripe", "invoicing", "yes");
    const m = mergeCells([a], [cell("stripe", "invoicing", "no"), cell("stripe", "stablecoin", "partial")]);
    expect(m.map((c) => `${c.need}:${c.support}`)).toEqual(["invoicing:yes", "stablecoin:partial"]);
  });
  it("the card counts what is still unknown and the summary admits it", () => {
    const card = buildSituationCard({ idea: "an app that sells tiny AI reports", needs: NEEDS, needsDefaulted: false, cells: [cell("stripe", "refunds_and_disputes", "yes")], probes: [], rounds: 3, searches: 20, stop: "max_rounds", railDefs: defs("stripe", "paypal"), discovered: [], conflicts: 0 });
    expect(card.unknown).toBe(3);
    const s = summarizeSituation(card);
    expect(s).toContain("stopped because max_rounds");
    expect(s).toContain("not a forecast");
  });
});

describe("open-ended rails", () => {
  const pages = [page("https://blog.example.com/mor", "For digital goods sold worldwide, Lemon Squeezy acts as merchant of record and handles tax. Razorpay is popular in India for UPI.")];
  const good = { name: "Lemon Squeezy", why: "merchant of record", url: pages[0].url, quote: "Lemon Squeezy acts as merchant of record and handles tax" };
  it("T-rails: keeps a rail the page actually names, with the page that named it", () => {
    const r = verifyRails([good], pages, RAILS);
    expect(r.kept[0]).toMatchObject({ id: "lemon-squeezy", name: "Lemon Squeezy", found: { url: pages[0].url } });
    expect(r.kept[0].alias).toContain("lemon squeezy");
  });
  it.each([
    ["a rail no page names", { ...good, name: "Paddle", quote: "acts as merchant of record and handles tax" }, "never names"],
    ["an invented quote", { ...good, quote: "Lemon Squeezy waives all fees for ever and ever" }, "quote is not in the fetched text"],
    ["a url that was not fetched", { ...good, url: "https://elsewhere.example.com" }, "url was not fetched"],
    ["a seed rail", { ...good, name: "Stripe", quote: "Lemon Squeezy acts as merchant of record" }, "already compared"],
  ])("drops %s", (_n, c, why) => expect(verifyRails([c], pages, RAILS).dropped[0]).toContain(why));
  it("dedupes within one reply and caps the comparison", () => {
    expect(verifyRails([good, good], pages, RAILS).kept).toHaveLength(1);
    const full = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, alias: [`r${i}`] }));
    expect(verifyRails([good], pages, full).dropped[0]).toContain("full");
  });
  it("a discovered rail's cells verify against its own aliases", () => {
    const d = verifyRails([good], pages, RAILS).kept;
    const all = [...RAILS, ...d];
    const m = new Map([["lemon-squeezy", pages]]);
    const r = verifyCells([{ rail: "lemon-squeezy", need: "cross_border_fx", support: "yes", url: pages[0].url, quote: "Lemon Squeezy acts as merchant of record" }], m, ["cross_border_fx"], all);
    expect(r.kept).toHaveLength(1);
    expect(verifyCells([{ rail: "lemon-squeezy", need: "cross_border_fx", support: "yes", url: pages[0].url, quote: "Lemon Squeezy acts as merchant of record" }], m, ["cross_border_fx"], RAILS).dropped[0]).toContain("not a rail in this comparison");
  });
  it("parseRails tolerates junk; scoutQueries are bounded", () => {
    expect(parseRails("x")).toEqual([]);
    expect(scoutQueries("x ".repeat(200)).every((q) => q.length < 140)).toBe(true);
  });
  it("mergeCellsDetail counts a later answer from another page that disagrees, and keeps the first", () => {
    const a = cell("stripe", "invoicing", "yes");
    const r = mergeCellsDetail([a], [{ ...cell("stripe", "invoicing", "no"), url: "https://other.example.com" }]);
    expect(r.cells).toHaveLength(1);
    expect(r.conflicts).toEqual([{ rail: "stripe", need: "invoicing" }]);
    expect(mergeCellsDetail([a], [{ ...cell("stripe", "invoicing", "no") }]).conflicts).toEqual([]); // same page, no real conflict
  });
});
