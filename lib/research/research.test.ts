import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import { segmentCitations, usedSources } from "./citations";
import { buildMessages, canonicalUrl, mergeSources, trimSources } from "./sources";

const w = (url: string, snippet: string, provider: WebSource["provider"] = "tavily"): WebSource => ({ url, title: url, snippet, publishedDate: null, provider, score: null });

describe("canonicalUrl", () => {
  it("ignores www, fragment, trailing slash and tracking params but keeps real params", () => {
    expect(canonicalUrl("https://www.a.example/x/?utm_source=z&id=3#top")).toBe("https://a.example/x?id=3");
    expect(canonicalUrl("https://a.example/x")).toBe("https://a.example/x");
  });
});

describe("mergeSources", () => {
  it("interleaves providers, dedupes by canonical url and numbers from 1", () => {
    const t = [w("https://a.example/1", "t1"), w("https://a.example/2", "t2")];
    const e = [w("https://www.a.example/1/?utm_x=1", "a much longer exa highlight", "exa"), w("https://b.example/3", "e3", "exa")];
    const m = mergeSources([t, e]);
    expect(m.map((s) => [s.n, s.url, s.host])).toEqual([[1, "https://a.example/1", "a.example"], [2, "https://a.example/2", "a.example"], [3, "https://b.example/3", "b.example"]]);
    expect(m[0].snippet).toBe("a much longer exa highlight");
    expect(m[0].provider).toBe("tavily");
  });
  it("caps at max and tolerates one empty provider", () => {
    expect(mergeSources([[], [w("https://a.example/1", "x"), w("https://a.example/2", "y"), w("https://a.example/3", "z")]], 2)).toHaveLength(2);
    expect(mergeSources([[], []])).toEqual([]);
  });
});

describe("trimSources + buildMessages", () => {
  const src = mergeSources([[w("https://a.example/1", "x".repeat(5000)), w("https://a.example/2", "short")]]);
  it("keeps the total prompt under the character budget", () => {
    const t = trimSources(src, 3000, 1500);
    expect(t[0].snippet.length).toBeLessThanOrEqual(1501);
    expect(t[1].snippet).toBe("short");
  });
  it("numbers sources in the prompt and puts the question first", () => {
    const [sys, user] = buildMessages("what?", src);
    expect(sys.role).toBe("system");
    expect(user.content).toMatch(/^Question: what\?\n\nSources:\n\[1\] https:\/\/a\.example\/1 \(a\.example\)/);
    expect(user.content).toContain("[2] https://a.example/2");
  });
});

describe("segmentCitations", () => {
  it("splits [1], [2][3] and [1, 2]", () => {
    expect(segmentCitations("A [1] b [2][3] c [1, 2].", 3)).toEqual([
      { kind: "text", text: "A " }, { kind: "cite", ns: [1] }, { kind: "text", text: " b " }, { kind: "cite", ns: [2] }, { kind: "cite", ns: [3] },
      { kind: "text", text: " c " }, { kind: "cite", ns: [1, 2] }, { kind: "text", text: "." },
    ]);
  });
  it("never renders a source we do not have", () => {
    expect(segmentCitations("x [9]", 3)).toEqual([{ kind: "text", text: "x [9]" }]);
    expect(segmentCitations("x [2, 9]", 3)).toEqual([{ kind: "text", text: "x " }, { kind: "cite", ns: [2] }]);
  });
  it("leaves an unfinished marker as text while streaming", () => {
    expect(segmentCitations("x [1", 3)).toEqual([{ kind: "text", text: "x [1" }]);
  });
  it("accepts gpt-oss native markers like 【3†L1-L4】 as citation 3", () => {
    expect(segmentCitations("win 【3†L1-L4】【5†L1-L4】", 8)).toEqual([
      { kind: "text", text: "win " }, { kind: "cite", ns: [3] }, { kind: "cite", ns: [5] },
    ]);
    expect(usedSources("a 【3†L1-L4】 b [1] c 【7】", 8)).toEqual([1, 3, 7]);
    expect(segmentCitations("x 【9†L1】", 3)).toEqual([{ kind: "text", text: "x 【9†L1】" }]);
  });
  it("usedSources is sorted and unique", () => {
    expect(usedSources("a [3] b [1] c [3][2] d [7]", 3)).toEqual([1, 2, 3]);
  });
});
