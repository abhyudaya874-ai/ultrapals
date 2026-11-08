import { describe, expect, it } from "vitest";
import { parseExa } from "./exa";

// Shape probed live 2026-11-08 and per docs.exa.ai: results[].id,title,url,publishedDate?,author?,highlights[].
const hit = { id: "x", title: "Winners", url: "https://developer.paypal.com/community/blog/winners-dev-days-hackathon", publishedDate: "2025-11-01T00:00:00.000Z", highlights: ["First.", "Second."] };

describe("parseExa", () => {
  it("joins highlights into one snippet", () => {
    expect(parseExa({ results: [hit] })).toEqual([
      { url: hit.url, title: "Winners", snippet: "First. [...] Second.", publishedDate: "2025-11-01T00:00:00.000Z", provider: "exa", score: null },
    ]);
  });
  it("tolerates a missing date and title", () => {
    const [r] = parseExa({ results: [{ url: "https://a.example/y", highlights: ["t"] }] });
    expect(r).toMatchObject({ title: "https://a.example/y", publishedDate: null });
  });
  it("drops rows with no highlight text or a non-http url", () => {
    expect(parseExa({ results: [{ ...hit, highlights: [] }, { ...hit, highlights: ["  "] }, { ...hit, url: "ftp://x.example" }, { url: "https://a.example" }] })).toEqual([]);
  });
  it("returns [] for junk", () => {
    expect(parseExa(undefined)).toEqual([]);
    expect(parseExa({ results: {} })).toEqual([]);
  });
});
