import { describe, expect, it } from "vitest";
import { byMonth, type StoredFile } from "./artifact-store";

const f = (path: string, iso: string): StoredFile => ({ path, content: "x", at: Date.parse(iso), source: "chat" });

describe("byMonth", () => {
  it("groups newest-first files under month headings and keeps order", () => {
    const g = byMonth([f("a", "2026-11-09T10:00:00Z"), f("b", "2026-11-01T00:00:00Z"), f("c", "2026-10-31T23:59:59Z")]);
    expect(g.map((m) => [m.month, m.files.map((x) => x.path)])).toEqual([["November 2026", ["a", "b"]], ["October 2026", ["c"]]]);
  });
  it("uses UTC so a file never changes month with the viewer's timezone", () => {
    expect(byMonth([f("a", "2026-12-01T00:00:00Z")])[0].month).toBe("December 2026");
  });
  it("nothing in, nothing out", () => expect(byMonth([])).toEqual([]));
});
