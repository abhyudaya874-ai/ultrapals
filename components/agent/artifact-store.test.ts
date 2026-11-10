import { describe, expect, it } from "vitest";
import { MAX_STORED_BYTES, MAX_STORED_FILES, mergeStored, parseStored, type StoredFile } from "./artifact-store";

const f = (path: string, at: number, content = "c", extra: Partial<StoredFile> = {}): StoredFile => ({ path, content, at, source: "chat", ...extra });

describe("parseStored", () => {
  it.each([[null], [""], ["not json"], ["{}"], ["[1,\"x\",null]"]])("%j -> nothing", (raw) => expect(parseStored(raw)).toEqual([]));
  it("keeps good entries newest first and drops bad ones", () => {
    const raw = JSON.stringify([f("a", 1), { path: "b" }, f("c", 3), { ...f("d", 2), source: "web" }]);
    expect(parseStored(raw).map((x) => x.path)).toEqual(["c", "a"]);
  });
});

describe("mergeStored", () => {
  it("replaces by path and keeps the newest first", () => {
    const m = mergeStored([f("a", 1, "old"), f("b", 2)], [f("a", 3, "new")]);
    expect(m.map((x) => [x.path, x.content])).toEqual([["a", "new"], ["b", "c"]]);
  });
  it("the same path from an automation is a separate artifact", () => {
    expect(mergeStored([f("a", 1)], [f("a", 2, "c", { source: "automation", from: "Daily digest" })])).toHaveLength(2);
  });
  it("does not let an older copy overwrite a newer one", () => {
    expect(mergeStored([f("a", 5, "newer")], [f("a", 2, "older")])[0].content).toBe("newer");
  });
  it("caps the number of files, dropping the oldest", () => {
    const many = Array.from({ length: MAX_STORED_FILES + 10 }, (_, i) => f(`f${i}`, i));
    const m = mergeStored([], many);
    expect(m).toHaveLength(MAX_STORED_FILES);
    expect(m[0].path).toBe(`f${MAX_STORED_FILES + 9}`);
  });
  it("caps total size, dropping the oldest, but never empties the list", () => {
    const big = "x".repeat(Math.floor(MAX_STORED_BYTES / 2) + 10);
    const m = mergeStored([], [f("old", 1, big), f("mid", 2, big), f("new", 3, big)]);
    expect(m.map((x) => x.path)).toEqual(["new"]);
  });
});
