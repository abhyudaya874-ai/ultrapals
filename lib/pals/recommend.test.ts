import { describe, expect, it } from "vitest";
import { excludeFamilies, familyOf, familyOfBare } from "./family";
import { blindMessages, contenders, judgeRecommendation, parseBlind, separated } from "./recommend";
import { cardHash, coreOf, receiptId } from "./receipt";
import { buildSituationCard, type Cell, type Need, type RailDef, type SituationCard } from "./situation";

const DEFS: RailDef[] = [{ id: "stripe", name: "Stripe", alias: ["stripe"] }, { id: "paypal", name: "PayPal", alias: ["paypal"] }, { id: "razorpay", name: "Razorpay", alias: ["razorpay"] }];
const NEEDS: Need[] = [{ need: "refunds_and_disputes", weight: 3, why: "" }, { need: "cross_border_fx", weight: 1, why: "" }];
const cell = (rail: string, need: Cell["need"], support: Cell["support"]): Cell => ({ rail, need, support, url: "https://x.example.com", quote: "q quote text", fetchedAtMs: 1 });
const mk = (cells: Cell[], o: Partial<SituationCard> = {}): SituationCard => ({ ...buildSituationCard({ idea: "i", needs: NEEDS, needsDefaulted: false, cells, probes: [], rounds: 2, searches: 6, stop: "complete", railDefs: DEFS, discovered: [], conflicts: 0 }), ...o });
const ALL_YES = [cell("stripe", "refunds_and_disputes", "yes"), cell("stripe", "cross_border_fx", "yes"), cell("paypal", "refunds_and_disputes", "no"), cell("paypal", "cross_border_fx", "no"), cell("razorpay", "refunds_and_disputes", "no"), cell("razorpay", "cross_border_fx", "no")];
const BLIND = { family: "nvidia", pick: "stripe", concern: "" };

describe("contenders / separated", () => {
  it("separated only when the leader beats every other rail's best case", () => {
    const c = mk(ALL_YES);
    expect(contenders(c)).toEqual(["stripe"]);
    expect(separated(c)).toBe(true);
  });
  it("an unanswered rival keeps the race open: its upper bound is 1", () => {
    const c = mk([cell("stripe", "refunds_and_disputes", "yes"), cell("stripe", "cross_border_fx", "yes")]);
    expect(contenders(c).sort()).toEqual(["paypal", "razorpay", "stripe"]);
    expect(separated(c)).toBe(false);
  });
});

describe("judgeRecommendation (T22/T23: pure, evidence in, outcome out)", () => {
  it("APPROVE needs a separated, well-known leader and a blind pick that agrees", () => {
    expect(judgeRecommendation(mk(ALL_YES), BLIND)).toMatchObject({ outcome: "APPROVE", reasons: ["SEPARATED"], leader: "stripe" });
  });
  it("missing evidence is HOLD, never APPROVE", () => {
    const r = judgeRecommendation(mk([]), BLIND);
    expect(r.outcome).toBe("HOLD");
    expect(r.reasons).toContain("NO_EVIDENCE");
  });
  it("an overlapping band is HOLD", () => expect(judgeRecommendation(mk([cell("stripe", "refunds_and_disputes", "yes"), cell("stripe", "cross_border_fx", "yes")]), BLIND)).toMatchObject({ outcome: "HOLD", reasons: expect.arrayContaining(["BAND_OVERLAP"]) }));
  it("no blind reader available is HOLD (unknown stays HOLD)", () => expect(judgeRecommendation(mk(ALL_YES), null)).toMatchObject({ outcome: "HOLD", reasons: ["BLIND_UNAVAILABLE"] }));
  it("a blind reader that picks an eliminated rail raises the case to FLAG", () => expect(judgeRecommendation(mk(ALL_YES), { ...BLIND, pick: "paypal" })).toMatchObject({ outcome: "FLAG", reasons: ["BLIND_DISAGREES"] }));
  it("a failed sandbox defect check on the leader is FLAG; PayPal's buyer-approval cost is not", () => {
    const bad = mk(ALL_YES, { probes: [{ rail: "stripe", check: "refund_read_back", outcome: "fail", detail: "x" }] });
    expect(judgeRecommendation(bad, BLIND).outcome).toBe("FLAG");
    const pp = mk([cell("paypal", "refunds_and_disputes", "yes"), cell("paypal", "cross_border_fx", "yes"), cell("stripe", "refunds_and_disputes", "no"), cell("stripe", "cross_border_fx", "no"), cell("razorpay", "refunds_and_disputes", "no"), cell("razorpay", "cross_border_fx", "no")], { probes: [{ rail: "paypal", check: "server_charge", outcome: "fail", detail: "buyer approved first" }] });
    expect(judgeRecommendation(pp, { ...BLIND, pick: "paypal" }).outcome).toBe("APPROVE");
  });
  it("defaulted needs and conflicting pages are HOLD", () => {
    expect(judgeRecommendation(mk(ALL_YES, { needsDefaulted: true }), BLIND).reasons).toContain("DEFAULT_NEEDS");
    expect(judgeRecommendation(mk(ALL_YES, { conflicts: 1 }), BLIND).reasons).toContain("CONFLICT");
  });
  it("there is no REJECT, whatever the evidence", () => {
    for (const cells of [[], ALL_YES]) for (const b of [null, BLIND, { ...BLIND, pick: "razorpay" }, "pending" as const]) expect(["APPROVE", "HOLD", "FLAG"]).toContain(judgeRecommendation(mk(cells), b).outcome);
  });
  it("pending blind adds no blind reason", () => expect(judgeRecommendation(mk(ALL_YES), "pending").outcome).toBe("APPROVE"));
  it("is deterministic and a JSON round trip of the card replays to the same outcome", () => {
    const c = mk(ALL_YES);
    const again = JSON.parse(JSON.stringify(c)) as SituationCard;
    expect(judgeRecommendation(again, BLIND)).toEqual(judgeRecommendation(c, BLIND));
  });
});

describe("blind check", () => {
  const c = mk(ALL_YES);
  it("T24: the blind input holds the typed grid only: no idea text, no rubric, no reasoning", () => {
    const text = blindMessages({ ...c, idea: "SECRET-IDEA-TEXT" }).map((m) => m.content).join("\n");
    expect(text).not.toContain("SECRET-IDEA-TEXT");
    expect(text).not.toMatch(/APPROVE|HOLD|FLAG|rubric/i);
    expect(text).toContain("stripe (Stripe)");
  });
  it("parseBlind accepts only a rail that is in the grid", () => {
    expect(parseBlind('{"pick":"stripe","concern":"fees"}', c)).toEqual({ pick: "stripe", concern: "fees" });
    expect(parseBlind('{"pick":"bitpay"}', c)).toBeNull();
    expect(parseBlind("nope", c)).toBeNull();
  });
});

describe("families", () => {
  const models = [{ provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" }, { provider: "bluesminds", model: "meta/muse-glimmer-30b" }, { provider: "openrouter", model: "openrouter/free" }] as never[];
  it("reads the vendor prefix, and recovers it from the bare name callModel returns", () => {
    expect(familyOf("openai/gpt-oss-120b")).toBe("openai");
    expect(familyOfBare("gpt-oss-120b", models)).toBe("openai");
    expect(familyOfBare("mystery-9b", models)).toBe("mystery-9b");
  });
  it("excludeFamilies removes used families and the router that has no stable family", () => {
    expect(excludeFamilies(models, new Set(["openai"])).map((m) => m.model)).toEqual(["nvidia/nemotron-3.5-lightning-30b-a3b", "meta/muse-glimmer-30b"]);
  });
});

describe("receipt", () => {
  it("the receipt id changes when the evidence, the rubric or the blind result changes", () => {
    const c = mk(ALL_YES);
    const sealed = { ...c, rubric: judgeRecommendation(c, BLIND), blind: BLIND };
    const id = receiptId(sealed);
    expect(receiptId({ ...sealed, cells: [{ ...sealed.cells[0], support: "no" }, ...sealed.cells.slice(1)] })).not.toBe(id);
    expect(receiptId({ ...sealed, blind: { ...BLIND, pick: "paypal" } })).not.toBe(id);
    expect(receiptId({ ...sealed, rubric: { ...sealed.rubric, outcome: "FLAG" } })).not.toBe(id);
  });
  it("the card hash ignores the stages computed from it, and survives a JSON round trip", () => {
    const c = mk(ALL_YES);
    const sealed = { ...c, rubric: judgeRecommendation(c, BLIND), blind: BLIND, receipt: { id: "x", cardHash: "y" } };
    expect(cardHash(sealed)).toBe(cardHash(c));
    expect(cardHash(JSON.parse(JSON.stringify(sealed)))).toBe(cardHash(c));
    expect(Object.keys(coreOf(sealed))).not.toContain("rubric");
  });
});
