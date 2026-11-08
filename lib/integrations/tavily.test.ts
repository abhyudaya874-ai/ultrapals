import { describe, expect, it } from "vitest";
import { parseTavily } from "./tavily";

// Shape follows docs.tavily.com/documentation/api-reference/endpoint/search (results[].title,url,content,score,published_date).
const hit = { title: "CrawlerPal", url: "https://github.com/positiveblue/CrawlerPal", content: "A paywall assistant for AI agents.", score: 0.81, published_date: "2025-11-01" };

describe("parseTavily", () => {
  it("maps a result to a WebSource", () => {
    expect(parseTavily({ results: [hit] })).toEqual([
      { url: hit.url, title: "CrawlerPal", snippet: "A paywall assistant for AI agents.", publishedDate: "2025-11-01", provider: "tavily", score: 0.81 },
    ]);
  });
  it("falls back to the url for a missing title and null for a missing date/score", () => {
    const [r] = parseTavily({ results: [{ url: "https://a.example/x", content: "text" }] });
    expect(r).toMatchObject({ title: "https://a.example/x", publishedDate: null, score: null });
  });
  it("drops non-http urls and rows with no text", () => {
    expect(parseTavily({ results: [{ ...hit, url: "javascript:alert(1)" }, { ...hit, content: "  " }, { ...hit, url: "not a url" }] })).toEqual([]);
  });
  it("returns [] for junk", () => {
    expect(parseTavily(null)).toEqual([]);
    expect(parseTavily({})).toEqual([]);
    expect(parseTavily({ results: "x" })).toEqual([]);
  });
});
