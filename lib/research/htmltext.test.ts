import { describe, expect, it } from "vitest";
import { htmlToText } from "./htmltext";

describe("htmlToText", () => {
  it("drops scripts, styles, comments, head and tags; breaks lines at blocks", () => {
    expect(htmlToText("<html><head><title>T</title></head><body><h1>Refunds</h1><script>alert(1)</script><p>Full <b>refunds</b> within 30 days.</p><!-- hidden --><style>p{}</style></body></html>")).toBe("Refunds\nFull refunds within 30 days.");
  });
  it("decodes entities and collapses whitespace", () => expect(htmlToText("<div>Tom &amp;   Jerry &lt;3</div>")).toBe("Tom & Jerry <3"));
  it("passes JSON and markdown through untouched", () => {
    expect(htmlToText('{"a":1}')).toBe('{"a":1}');
    expect(htmlToText("# Title\n\nText")).toBe("# Title\n\nText");
  });
});
