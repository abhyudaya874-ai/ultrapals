import { describe, expect, it } from "vitest";
import { numericColumn, parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists, quotes and rules", () => {
    expect(parseMarkdown("# Title\n\nSome **text**\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n> quoted\n\n---")).toEqual([
      { t: "h", level: 1, text: "Title" },
      { t: "p", text: "Some **text**\nsecond line" },
      { t: "ul", items: [{ text: "a" }, { text: "b" }] },
      { t: "ol", items: [{ text: "one" }, { text: "two" }], start: 1 },
      { t: "quote", text: "quoted" },
      { t: "hr" },
    ]);
  });
  it("keeps fenced code verbatim, even if it looks like markdown, and survives a missing closing fence", () => {
    expect(parseMarkdown("```js\n# not a heading\n- not a list\n```")).toEqual([{ t: "code", lang: "js", text: "# not a heading\n- not a list" }]);
    expect(parseMarkdown("```\nopen")).toEqual([{ t: "code", lang: "", text: "open" }]);
  });
  it("reads a table with a separator row", () => {
    expect(parseMarkdown("| rail | fit |\n| --- | --- |\n| Stripe | 0.8 |\n| Square | 0.6 |")).toEqual([{ t: "table", head: ["rail", "fit"], rows: [["Stripe", "0.8"], ["Square", "0.6"]], align: ["left", "left"] }]);
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

describe("tables, the way models write them", () => {
  const T = (src: string) => parseMarkdown(src).find((b) => b.t === "table") as Extract<ReturnType<typeof parseMarkdown>[number], { t: "table" }>;
  it("reads column alignment from the separator row", () => {
    expect(T("| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |").align).toEqual(["left", "center", "right", "left"]);
  });
  it("a table with no outer pipes is still a table", () => {
    expect(T("rail | fee\n--- | ---\nStripe | 2.9%").rows).toEqual([["Stripe", "2.9%"]]);
  });
  it("a pipe written \\| stays inside its cell, and <br> is a line break in it", () => {
    expect(T("| expr | note |\n|---|---|\n| a \\| b | one<br>two |").rows).toEqual([["a | b", "one\ntwo"]]);
  });
  it("a short row is padded and a long one cut to the header's width, so the columns line up", () => {
    const t = T("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(t.rows).toEqual([["1", "", ""], ["1", "2", "3"]]);
    expect(t.align).toHaveLength(3);
  });
  it("a table in the middle of a reply is found between its paragraphs", () => {
    const b = parseMarkdown("Here is the comparison:\n\n| Axis | Status |\n|---|---|\n| Fees | done |\n\nThat is all.");
    expect(b.map((x) => x.t)).toEqual(["p", "table", "p"]);
  });
  it("a table that is still arriving is plain text until its separator row is there, then a table", () => {
    expect(parseMarkdown("| Axis | Status |").map((x) => x.t)).toEqual(["p"]);
    expect(parseMarkdown("| Axis | Status |\n|---|---|").map((x) => x.t)).toEqual(["table"]);
    expect(T("| Axis | Status |\n|---|---|\n| Fe").rows).toEqual([["Fe", ""]]);
  });
  it("finds the columns whose every value is a number, with a unit or a sign", () => {
    const rows = [["Stripe", "2.9%", "$0.30", "n/a"], ["Square", "3.3%", "$0.30", "12"], ["PayPal", "3.49%", "$0.49", "7"]];
    expect([0, 1, 2, 3].map((k) => numericColumn(rows, k))).toEqual([false, true, true, false]);
    expect(numericColumn([["1"]], 0)).toBe(false); // one cell is no evidence
    expect(numericColumn([["~40"], ["<1%"], ["131K"], ["250ms"]], 0)).toBe(true);
    expect(numericColumn([["12 apples"], ["3"]], 0)).toBe(false);
  });
});

describe("lists", () => {
  it("nests a sub-list under its item", () => {
    expect(parseMarkdown("- fees\n  - fixed\n  - percentage\n- limits")).toEqual([
      { t: "ul", items: [{ text: "fees", sub: [{ t: "ul", items: [{ text: "fixed" }, { text: "percentage" }] }] }, { text: "limits" }] },
    ]);
  });
  it("nests a numbered list under a bullet and keeps where a numbered list starts", () => {
    const b = parseMarkdown("3. third\n4. fourth\n   - detail");
    expect(b).toEqual([{ t: "ol", start: 3, items: [{ text: "third" }, { text: "fourth", sub: [{ t: "ul", items: [{ text: "detail" }] }] }] }]);
  });
  it("a list ends at the first line that is not part of it, and a different kind starts a new list", () => {
    expect(parseMarkdown("- a\n- b\nparagraph\n\n1. one\n- x").map((x) => x.t)).toEqual(["ul", "p", "ol", "ul"]);
  });
  it("an item can carry a second paragraph under it", () => {
    expect(parseMarkdown("- first\n\n  more about first\n- second")).toEqual([{ t: "ul", items: [{ text: "first", sub: [{ t: "p", text: "more about first" }] }, { text: "second" }] }]);
  });
  it("accepts the bullet characters models use", () => {
    expect(parseMarkdown("• a\n• b")).toEqual([{ t: "ul", items: [{ text: "a" }, { text: "b" }] }]);
    expect(parseMarkdown("* a\n+ b")[0]).toMatchObject({ t: "ul" });
  });
  it("always terminates, whatever the indentation", () => {
    for (const s of ["- a\n      - deep\n  - mid\n- top", "   - lone", "1. a\n     2. b", "- \n- ", "-\n  - x"]) expect(() => parseMarkdown(s)).not.toThrow();
  });
});

describe("inline: italics, strike and what must stay as it is", () => {
  it("reads *italic*, _italic_ and ~~strike~~", () => {
    expect(parseInline("a *b* c _d_ ~~e~~")).toEqual([{ k: "text", text: "a " }, { k: "i", text: "b" }, { k: "text", text: " c " }, { k: "i", text: "d" }, { k: "text", text: " " }, { k: "s", text: "e" }]);
  });
  it.each(["2 * 3 * 4", "snake_case_name", "a * b", "file_name.txt and other_file.md", "5*3", "**", "* not italic *"])("leaves %j alone", (t) => {
    expect(parseInline(t).every((p) => p.k === "text")).toBe(true);
  });
  it("bold wins over italics when both could match", () => expect(parseInline("**bold** and *it*")).toEqual([{ k: "b", text: "bold" }, { k: "text", text: " and " }, { k: "i", text: "it" }]));
});
