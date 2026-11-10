import { describe, expect, it } from "vitest";
import { pickEvidence } from "./evidence";

const page = (url: string, text: string) => ({ url, text, fetchedAtMs: 5, operator: "tavily" as const });

describe("pickEvidence", () => {
  it("returns a verbatim quote with the fetcher's time and operator", () => {
    const p = page("https://a.example.com", "Stripe sandboxes let you run test clocks to advance renewals. Other text follows here.");
    const e = pickEvidence("Stripe", [p]);
    expect(e).toMatchObject({ url: p.url, operator: "tavily", fetchedAtMs: 5 });
    expect(p.text.includes(e!.quote)).toBe(true);
    expect(e!.quote.length).toBeLessThanOrEqual(200);
  });
  it("is case-insensitive and picks the first page that mentions the company", () => {
    expect(pickEvidence("wise", [page("https://x.example.com", "nothing"), page("https://y.example.com", "Why WISE quotes the fee up front before you commit.")])?.url).toBe("https://y.example.com");
  });
  it("returns null rather than inventing a source", () => {
    expect(pickEvidence("Klarna", [page("https://x.example.com", "Only PayPal is discussed here, at length.")])).toBeNull();
    expect(pickEvidence("Klarna", [])).toBeNull();
  });
  it("collapsed whitespace never produces a quote that is not in the text", () => {
    const p = page("https://z.example.com", "Square   lets sellers\n\ntake orders in chat apps today.");
    const e = pickEvidence("Square", [p]);
    expect(e === null || p.text.includes(e.quote)).toBe(true);
  });
});
