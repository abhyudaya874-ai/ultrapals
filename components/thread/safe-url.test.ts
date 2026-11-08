import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/agent/types";
import { hostLabel, safeHttpUrl, sourcesFromTrace } from "./safe-url";

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

describe("sourcesFromTrace", () => {
  const ev = (name: string, args: Record<string, unknown>): TraceEvent =>
    ({ kind: "tool", id: name, name, args, state: "ok" });
  it("collects http(s) args, de-duplicates, ignores everything else", () => {
    const out = sourcesFromTrace([
      ev("kernel.observe", { url: "https://shop.example/a" }),
      ev("fetch.page", { url: "https://shop.example/a" }), // same href -> one source
      ev("kernel.observe", { url: "https://other.example/b" }),
      ev("paypal.getOrder", { orderId: "O-1" }),
      ev("channel3.search", { query: "shoes" }),
      { kind: "thought", id: "t", text: "see https://not-an-arg.example" },
    ]);
    expect(out.map((s) => s.host)).toEqual(["shop.example", "other.example"]);
  });
  it("empty trace -> no sources", () => expect(sourcesFromTrace([])).toEqual([]));
});
