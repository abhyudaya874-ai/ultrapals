import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists, quotes and rules", () => {
    expect(parseMarkdown("# Title\n\nSome **text**\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n> quoted\n\n---")).toEqual([
      { t: "h", level: 1, text: "Title" },
      { t: "p", text: "Some **text**\nsecond line" },
      { t: "ul", items: ["a", "b"] },
      { t: "ol", items: ["one", "two"] },
      { t: "quote", text: "quoted" },
      { t: "hr" },
    ]);
  });
  it("keeps fenced code verbatim, even if it looks like markdown, and survives a missing closing fence", () => {
    expect(parseMarkdown("```js\n# not a heading\n- not a list\n```")).toEqual([{ t: "code", lang: "js", text: "# not a heading\n- not a list" }]);
    expect(parseMarkdown("```\nopen")).toEqual([{ t: "code", lang: "", text: "open" }]);
  });
  it("reads a table with a separator row", () => {
    expect(parseMarkdown("| rail | fit |\n| --- | --- |\n| Stripe | 0.8 |\n| Square | 0.6 |")).toEqual([{ t: "table", head: ["rail", "fit"], rows: [["Stripe", "0.8"], ["Square", "0.6"]] }]);
  });
  it("a pipe in ordinary text is not a table", () => expect(parseMarkdown("a | b")).toEqual([{ t: "p", text: "a | b" }]));
  it("clamps deep headings to level 3", () => expect(parseMarkdown("###### deep")).toEqual([{ t: "h", level: 3, text: "deep" }]));
  it("always terminates on odd input", () => {
    for (const s of ["", "\n\n", "|", "> ", "- ", "```", "#", "* * *", "1)", "|\n|"]) expect(() => parseMarkdown(s)).not.toThrow();
  });
});

describe("parseInline", () => {
  it("splits bold, code and links", () => {
    expect(parseInline("a **b** `c` [d](https://x.test/p) e")).toEqual([
      { k: "text", text: "a " }, { k: "b", text: "b" }, { k: "text", text: " " }, { k: "code", text: "c" }, { k: "text", text: " " },
      { k: "a", text: "d", href: "https://x.test/p" }, { k: "text", text: " e" },
    ]);
  });
  it.each(["javascript:void", "data:text/html,x", "//evil.test", "file:///etc/passwd"])("does not make a link of %s", (u) => {
    expect(parseInline(`[x](${u})`)).toEqual([{ k: "text", text: `[x](${u})` }]);
  });
});
