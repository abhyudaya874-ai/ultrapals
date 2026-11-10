import { describe, expect, it } from "vitest";
import { artifactPath, csvOf, parseCsv, putFile, workspaceDigest, writeArtifact } from "./artifacts";
import { collect, mkDeps, mkSession, ok, scripted } from "./fakes";

describe("csvOf", () => {
  it("quotes commas, quotes and newlines", () => expect(csvOf(["a", "b"], [["x,y", 'say "hi"'], ["l1\nl2", 3]])).toBe('a,b\n"x,y","say ""hi"""\n"l1\nl2",3\n'));
  it("neutralises spreadsheet formulas that came from a web page", () => {
    const out = csvOf(["quote"], [["=HYPERLINK(\"http://evil\")"], ["+1"], ["-2"], ["@SUM(A1)"], ["fine"]]);
    for (const l of out.trim().split("\n").slice(1, 5)) expect(l.replace(/^"/, "")).toMatch(/^'/);
    expect(out).toContain("\nfine\n");
  });
  it("null and undefined are empty cells", () => expect(csvOf(["a", "b"], [[null, undefined]])).toBe("a,b\n,\n"));
});

describe("artifactPath", () => {
  it.each([["sources.csv", "artifacts/sources.csv"], ["pages/1-stripe.md", "artifacts/pages/1-stripe.md"]])("accepts %s", (n, want) => expect(artifactPath(n)).toBe(want));
  it.each([["../etc/passwd"], ["a/b/c.csv"], ["x.sh"], [".hidden.csv"], ["with space.csv"], ["a b.md"]])("refuses %s", (n) => expect(artifactPath(n)).toBeNull());
});

describe("putFile", () => {
  it("reports created, then edited with line counts", () => {
    const a = putFile({}, "artifacts/a.csv", "h\n1\n2\n")!;
    expect(a).toMatchObject({ created: true, removes: 0 });
    const b = putFile(a.files, "artifacts/a.csv", "h\n1\n3\n")!;
    expect(b).toMatchObject({ created: false, adds: 1, removes: 1 });
  });
  it("caps one file and the number of files, dropping the oldest", () => {
    expect(putFile({}, "artifacts/big.md", "x".repeat(70_000))!.files["artifacts/big.md"].length).toBeLessThan(61_000);
    let files: Record<string, string> = {};
    for (let i = 0; i < 45; i++) files = putFile(files, `artifacts/f${i}.md`, "x")!.files;
    expect(Object.keys(files)).toHaveLength(40);
    expect(files["artifacts/f0.md"]).toBeUndefined();
    expect(files["artifacts/f44.md"]).toBe("x");
  });
});

describe("workspaceDigest", () => {
  it("shows a CSV's header and first rows, newest files, capped", () => {
    const d = workspaceDigest({ "artifacts/cells.csv": "rail,need,support\nstripe,refunds,yes\nsquare,refunds,no\n" });
    expect(d).toContain("## artifacts/cells.csv");
    expect(d).toContain("stripe,refunds,yes");
    expect(workspaceDigest({})).toBe("(no files yet)");
    expect(workspaceDigest({ "artifacts/a.md": "y".repeat(9000) }).length).toBeLessThanOrEqual(2200);
  });
});

describe("writeArtifact", () => {
  const ctx = (session = mkSession({ vm: null })) => ({ agent: "research-1", session, deps: mkDeps(scripted(["x"]).open) });
  it("stores the file in the session and shows it as a file event", async () => {
    const c = ctx();
    const { ev, ret } = await collect(writeArtifact(c, "sources.csv", "a,b\n1,2\n"));
    expect(ret).toBe(true);
    expect(c.session.files["artifacts/sources.csv"]).toBe("a,b\n1,2\n");
    expect(ev).toEqual([expect.objectContaining({ kind: "file", path: "/workspace/artifacts/sources.csv", created: true, adds: 2 })]);
  });
  it("mirrors into the running cloud computer, and a failed mirror loses nothing", async () => {
    const written: string[] = [];
    const c = ctx(mkSession());
    c.deps = mkDeps(scripted(["x"]).open, { term: { write: (async (_v: string, p: string) => (written.push(p), ok({ path: p, created: true, adds: 1, removes: 0 }))) as never } });
    await collect(writeArtifact(c, "n.md", "hello\n"));
    expect(written).toEqual(["/workspace/artifacts/n.md"]);
    c.deps = mkDeps(scripted(["x"]).open, { term: { write: (async () => { throw new Error("vm gone"); }) as never } });
    await collect(writeArtifact(c, "m.md", "kept\n"));
    expect(c.session.files["artifacts/m.md"]).toBe("kept\n");
  });
  it("carries a green/red patch against what the file held before", async () => {
    const c = ctx();
    const first = await collect(writeArtifact(c, "n.md", "one\ntwo\n"));
    expect(first.ev[0]).toMatchObject({ mode: "write", patch: [{ op: "add", text: "one", b: 1 }, { op: "add", text: "two", b: 2 }] });
    const second = await collect(writeArtifact(c, "n.md", "one\nTWO\n"));
    expect(second.ev[0]).toMatchObject({ created: false, adds: 1, removes: 1 });
    expect((second.ev[0] as { patch: { op: string }[] }).patch.map((l) => l.op)).toEqual(["ctx", "del", "add"]);
  });
  it("refuses an unsafe name without writing", async () => {
    const c = ctx();
    expect((await collect(writeArtifact(c, "../x.csv", "a"))).ret).toBe(false);
    expect(c.session.files).toEqual({});
  });
});

describe("parseCsv", () => {
  it("round-trips what csvOf writes, including quotes, commas and newlines inside a cell", () => {
    const rows = [["x,y", 'say "hi"', "l1\nl2"], ["=SUM(A1)", "", "ok"]];
    const parsed = parseCsv(csvOf(["a", "b", "c"], rows));
    expect(parsed[0]).toEqual(["a", "b", "c"]);
    expect(parsed[1]).toEqual(["x,y", 'say "hi"', "l1\nl2"]);
    expect(parsed[2]).toEqual(["'=SUM(A1)", "", "ok"]); // the formula guard survives
  });
  it("caps the rows it returns", () => expect(parseCsv("a\n".repeat(100), 10)).toHaveLength(10));
});
