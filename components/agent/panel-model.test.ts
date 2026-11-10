import { describe, expect, it } from "vitest";
import { applyCEvent, newRun } from "@/lib/computer/run";
import type { CEvent } from "@/lib/computer/events";
import { NO_PANEL, appTab, baseName, collectFiles, displayName, fileKind, fileTab, parseTab, totals, withTab, withoutTab } from "./panel-model";

const file = (agent: string, path: string, extra: Partial<Extract<CEvent, { kind: "file" }>> = {}): CEvent => ({ kind: "file", agent, id: path + (extra.mode ?? "w"), path, created: true, adds: 1, removes: 0, preview: "x", ...extra });
const run = (...e: CEvent[]) => e.reduce(applyCEvent, newRun("r", "p"));

describe("parseTab", () => {
  it.each([
    ["browser", { kind: "browser" }],
    ["terminal", { kind: "terminal" }],
    ["sources", { kind: "sources" }],
    [fileTab("/workspace/a.csv"), { kind: "file", path: "/workspace/a.csv" }],
    [fileTab("a:b.md"), { kind: "file", path: "a:b.md" }],
    [appTab("newsroom"), { kind: "app", name: "newsroom" }],
    ["agent:research-1", { kind: "agent", id: "research-1" }],
    ["app:nope", null],
    ["file:", null],
    ["weird", null],
    ["other:x", null],
  ])("%s", (id, want) => expect(parseTab(id)).toEqual(want));
});

describe("names", () => {
  it.each([["/workspace/artifacts/pages/x.md", "pages/x.md", "x.md"], ["/workspace/site/index.html", "site/index.html", "index.html"], ["rivals.csv", "rivals.csv", "rivals.csv"]])("%s", (p, d, b) => {
    expect(displayName(p)).toBe(d);
    expect(baseName(p)).toBe(b);
  });
  it.each([["a.CSV", "csv"], ["n.md", "md"], ["d.json", "json"], ["x.html", "text"], ["noext", "text"]])("kind of %s", (p, k) => expect(fileKind(p)).toBe(k));
});

describe("collectFiles", () => {
  it("is one entry per path, newest write wins, order of first appearance", () => {
    const r = run(file("t-1", "/workspace/a.md", { preview: "v1" }), file("t-1", "/workspace/b.csv"), file("t-2", "/workspace/a.md", { preview: "v2", created: false }));
    const f = collectFiles([r]);
    expect(f.map((x) => [x.name, x.writes, x.content])).toEqual([["a.md", 2, "v2"], ["b.csv", 1, "x"]]);
    expect(f[0].agent).toBe("t-2");
  });
  it("a read of a file nobody wrote shows its text; a later write replaces it", () => {
    const rd = file("t-1", "/workspace/n.txt", { mode: "read", preview: "read text", created: false, adds: 0 });
    expect(collectFiles([run(rd)])[0]).toMatchObject({ content: "read text", reads: 1, writes: 0 });
    const both = collectFiles([run(rd, file("t-1", "/workspace/n.txt", { preview: "written" }))])[0];
    expect(both).toMatchObject({ content: "written", reads: 1, writes: 1 });
  });
  it("merges across runs", () => {
    expect(collectFiles([run(file("a-1", "/workspace/x.md")), run(file("a-2", "/workspace/x.md"))])).toHaveLength(1);
  });
});

describe("totals", () => {
  it("adds writes and ignores reads", () => {
    const f = collectFiles([run(file("a", "/w/a", { adds: 5, removes: 2 }), file("a", "/w/b", { adds: 3, removes: 0 }), file("a", "/w/c", { mode: "read", adds: 99, removes: 99 }))]);
    expect(totals(f.flatMap((x) => [x.write, x.read].filter((e) => e !== undefined)))).toEqual({ adds: 8, removes: 2 });
  });
});

describe("withTab / withoutTab", () => {
  it("a quiet tab does not open the panel or steal focus", () => {
    const p = withTab(NO_PANEL, "terminal", false);
    expect(p).toEqual({ open: false, tabs: ["terminal"], active: "terminal" }); // the first tab is the active one so the panel is never blank when it opens
    expect(withTab({ open: true, tabs: ["file:a"], active: "file:a" }, "terminal", false)).toEqual({ open: true, tabs: ["file:a", "terminal"], active: "file:a" });
  });
  it("a focused tab opens the panel and becomes active; reopening it adds no duplicate", () => {
    const p = withTab(withTab(NO_PANEL, "sources", false), "file:a", true);
    expect(p).toEqual({ open: true, tabs: ["sources", "file:a"], active: "file:a" });
    expect(withTab(p, "file:a", true).tabs).toEqual(["sources", "file:a"]);
  });
  it("closing the active tab activates its left neighbour, or the next when it was first", () => {
    const p = { open: true, tabs: ["a", "b", "c"], active: "b" };
    expect(withoutTab(p, "b")).toEqual({ open: true, tabs: ["a", "c"], active: "a" });
    expect(withoutTab({ ...p, active: "a" }, "a")).toEqual({ open: true, tabs: ["b", "c"], active: "b" });
  });
  it("closing a background tab keeps the active one; closing an unknown tab changes nothing", () => {
    const p = { open: true, tabs: ["a", "b"], active: "a" };
    expect(withoutTab(p, "b")).toEqual({ open: true, tabs: ["a"], active: "a" });
    expect(withoutTab(p, "zzz")).toBe(p);
  });
  it("closing the last tab closes the panel", () => expect(withoutTab({ open: true, tabs: ["a"], active: "a" }, "a")).toEqual(NO_PANEL));
});
