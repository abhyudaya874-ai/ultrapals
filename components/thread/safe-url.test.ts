import { describe, expect, it } from "vitest";
import { hostLabel, safeHttpUrl } from "./safe-url";

const ROWS: [string, unknown, string | null][] = [
  ["https url", "https://www.example.com/a?b=1", "example.com"],
  ["http url", "http://shop.test/x", "shop.test"],
  ["javascript: is refused", "javascript:alert(1)", null],
  ["data: is refused", "data:text/html,<b>x</b>", null],
  ["not a url", "hello world", null],
  ["not a string", { url: "https://a.b" }, null],
  ["undefined", undefined, null],
];
describe("safeHttpUrl + hostLabel", () => {
  it.each(ROWS)("%s", (_n, input, want) => {
    const u = safeHttpUrl(input);
    expect(u === null ? null : hostLabel(u)).toBe(want);
  });
});
