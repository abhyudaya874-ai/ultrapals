import { describe, expect, it } from "vitest";
import { lineDiffStats } from "@/lib/integrations/kterm";
import { diffLines, readRows } from "./diff";

const ops = (p: ReturnType<typeof diffLines>) => p.lines.map((l) => `${l.op}:${l.text}`);

describe("diffLines", () => {
  it("a new file is all additions with new line numbers", () => {
    const p = diffLines("", "a\nb\nc\n");
    expect(p).toMatchObject({ adds: 3, removes: 0, cut: 0 });
    expect(p.lines.map((l) => [l.op, l.b, l.a])).toEqual([["add", 1, undefined], ["add", 2, undefined], ["add", 3, undefined]]);
  });
  it("an emptied file is all removals", () => {
    expect(diffLines("a\nb", "")).toMatchObject({ adds: 0, removes: 2 });
  });
  it("identical text has no rows", () => {
    expect(diffLines("same\ntext", "same\ntext")).toEqual({ lines: [], adds: 0, removes: 0, cut: 0 });
  });
  it("a changed line is one removal then one addition, with context and both numbers", () => {
    const p = diffLines("a\nb\nc", "a\nB\nc");
    expect(ops(p)).toEqual(["ctx:a", "del:b", "add:B", "ctx:c"]);
    expect(p.lines[1]).toMatchObject({ a: 2 });
    expect(p.lines[2]).toMatchObject({ b: 2 });
  });
  it("far-away unchanged lines collapse into one gap row", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const next = old.replace("l10", "X");
    const p = diffLines(old, next, { context: 1 });
    expect(ops(p)).toEqual(["gap:9 unchanged lines", "ctx:l9", "del:l10", "add:X", "ctx:l11", "gap:8 unchanged lines"]);
  });
  it("matches lineDiffStats on a table of cases", () => {
    const cases: [string, string][] = [["", "a"], ["a\nb\nc", "a\nb\nc\nd"], ["a\nb", ""], ["x\ny\nz", "y\nz\nx"], ["a\nb\nc\nd\ne", "a\nc\ne\nf"], ["same", "same"]];
    for (const [a, b] of cases) {
      const p = diffLines(a, b);
      expect({ adds: p.adds, removes: p.removes }).toEqual(lineDiffStats(a, b));
    }
  });
  it("caps the rows and says how many were cut", () => {
    const p = diffLines("", Array.from({ length: 50 }, (_, i) => `n${i}`).join("\n"), { maxLines: 10 });
    expect(p.lines).toHaveLength(10);
    expect(p).toMatchObject({ adds: 50, cut: 40 });
  });
  it("falls back to remove-all then add-all beyond the LCS budget", () => {
    const big = (s: string) => Array.from({ length: 2100 }, (_, i) => `${s}${i}`).join("\n");
    const p = diffLines(big("a"), big("b"), { maxLines: 5000 });
    expect(p).toMatchObject({ adds: 2100, removes: 2100 });
  });
});

describe("readRows", () => {
  it("numbers lines from 1 and reports what was left out", () => {
    const r = readRows("a\nb\nc\nd", 2);
    expect(r.lines).toEqual([{ op: "ctx", text: "a", b: 1 }, { op: "ctx", text: "b", b: 2 }]);
    expect(r).toMatchObject({ total: 4, cut: 2 });
  });
  it("an empty file has no rows", () => expect(readRows("")).toEqual({ lines: [], total: 0, cut: 0 }));
});
