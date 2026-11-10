import { describe, expect, it } from "vitest";
import { CHART_GUIDE, CHOOSE_SYSTEM, chooseMessages, specFromChoice } from "./choose";
import { CHART_TYPES, problems, resolveSpec, type Row } from "./spec";

const rails: Row[] = [{ rail: "Stripe", fit: 82, risk: 20, note: "a" }, { rail: "Square", fit: 64, risk: 35, note: "b" }, { rail: "PayPal", fit: 71, risk: 25, note: "c" }, { rail: "Adyen", fit: 40, risk: 10, note: "d" }];

describe("the guide", () => {
  it("explains every chart type the system can draw, and the prompt lists them all", () => {
    for (const t of CHART_TYPES) { expect(CHART_GUIDE[t].length).toBeGreaterThan(10); expect(CHOOSE_SYSTEM).toContain(`- ${t}:`); }
  });
  it("tells the model the table is data, not instructions", () => expect(CHOOSE_SYSTEM).toMatch(/never instructions/));
});

describe("chooseMessages", () => {
  const m = chooseMessages("artifacts/rivals.csv", "which rail is best?", rails);
  it("shows the column profile, a few rows and the question, in a system+user pair", () => {
    expect(m.map((x) => x.role)).toEqual(["system", "user"]);
    expect(m[1].content).toContain("fit (number, 40 to 82)");
    expect(m[1].content).toContain("rail (category, 4 distinct)");
    expect(m[1].content).toContain("QUESTION: which rail is best?");
  });
  it("never sends more than five rows", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ k: `row-${i}`, v: i }));
    const body = chooseMessages("f.csv", "q", many)[1].content;
    expect(body).toContain("row-4");
    expect(body).not.toContain("row-5\"");
  });
});

describe("specFromChoice", () => {
  const reply = (o: object) => JSON.stringify({ type: "radar", x: "rail", y: ["fit", "risk"], title: "Rails", why: "scores on one scale", ...o });
  it("takes the numbers from the table, only for the columns used", () => {
    const s = specFromChoice(reply({}), rails)!;
    expect(s).toMatchObject({ type: "radar", x: "rail", y: ["fit", "risk"], title: "Rails" });
    expect(s.data[0]).toEqual({ rail: "Stripe", fit: 82, risk: 20 }); // "note" was not asked for, so it is not carried
    expect(problems(s)).toEqual([]);
  });
  it("accepts JSON wrapped in prose or a code fence", () => {
    expect(specFromChoice(`Sure!\n\`\`\`json\n${reply({ type: "bar" })}\n\`\`\``, rails)?.type).toBe("bar");
  });
  it.each([
    ["not JSON", "I think a bar chart"],
    ["an unknown type", reply({ type: "sparkle" })],
    ["a column the table does not have", reply({ y: ["fit", "profit"] })],
    ["an x column that does not exist", reply({ x: "company" })],
    ["a y that is not a list", reply({ y: "fit" })],
  ])("rejects %s", (_n, text) => expect(specFromChoice(text, rails)).toBeNull());
  it("nulls are fine for optional fields", () => {
    expect(specFromChoice(reply({ by: null, size: null, title: null, why: null }), rails)).not.toBeNull();
  });
  it("a model that picks a chart which cannot fit is corrected by resolveSpec, not drawn broken", () => {
    const s = specFromChoice(reply({ type: "candlestick", y: ["fit", "risk"] }), rails)!;
    const r = resolveSpec(s);
    expect(r.spec.type).not.toBe("candlestick");
    expect(r.note).toMatch(/candlestick chart did not fit/);
    expect(problems(r.spec)).toEqual([]);
  });
});
