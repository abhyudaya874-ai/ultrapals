import { describe, expect, it } from "vitest";
import { resolveNavUrl } from "@/lib/integrations/kbrowser";
import { clipOutput, lineDiffStats, shq, workPath } from "@/lib/integrations/kterm";

describe("workPath", () => {
  it("keeps files inside /workspace (or /tmp); relative paths are workspace-relative", () => {
    expect(workPath("src/app.js")).toBe("/workspace/src/app.js");
    expect(workPath("/workspace/a/./b.txt")).toBe("/workspace/a/b.txt");
    expect(workPath("/tmp/x.log")).toBe("/tmp/x.log");
  });
  it("refuses escapes and junk", () => {
    for (const p of ["../etc/passwd", "/etc/passwd", "a/../../etc/shadow", "/workspace/../root/.ssh/id", "", "a\0b", "/workspacex/y"]) expect(workPath(p)).toBeNull();
  });
  it("normalises .. that stays inside", () => {
    expect(workPath("a/b/../c.txt")).toBe("/workspace/a/c.txt");
  });
});

describe("lineDiffStats", () => {
  it("counts a new file as all additions", () => expect(lineDiffStats("", "a\nb\nc")).toEqual({ adds: 3, removes: 0 }));
  it("does not count the final newline as a line", () => expect(lineDiffStats("", "a\nb\nc\n")).toEqual({ adds: 3, removes: 0 }));
  it("counts real edits, not whole-file rewrites", () => {
    expect(lineDiffStats("a\nb\nc", "a\nB\nc")).toEqual({ adds: 1, removes: 1 });
    expect(lineDiffStats("a\nb\nc", "a\nb\nc\nd")).toEqual({ adds: 1, removes: 0 });
    expect(lineDiffStats("a\nb", "")).toEqual({ adds: 0, removes: 2 });
    expect(lineDiffStats("same", "same")).toEqual({ adds: 0, removes: 0 });
  });
});

describe("shq / clipOutput", () => {
  it("single-quotes safely (the classic breakout)", () => expect(shq("it's $(rm -rf /) `x`")).toBe(`'it'\\''s $(rm -rf /) \`x\`'`));
  it("keeps the tail of long output and says how much was cut", () => {
    const out = clipOutput(`${"x".repeat(100)}ERROR at end`, 20);
    expect(out.endsWith("ERROR at end".slice(-20))).toBe(true);
    expect(out).toContain("chars cut");
    expect(clipOutput("short")).toBe("short");
  });
});

describe("resolveNavUrl", () => {
  it("allows the VM's own localhost and public pages only", () => {
    expect(resolveNavUrl("http://localhost:4173/")).toBe("http://localhost:4173/");
    expect(resolveNavUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveNavUrl("https://example.com/a")).toBe("https://example.com/a");
  });
  it("still blocks private ranges, metadata endpoints and odd schemes", () => {
    for (const u of ["http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://192.168.1.1", "file:///etc/passwd", "http://localhost.evil.example:80x"]) expect(() => resolveNavUrl(u)).toThrow();
  });
});
