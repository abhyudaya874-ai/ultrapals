import { describe, expect, it } from "vitest";
import { matchRanges, rank, score } from "./palette";

describe("score", () => {
  it("an empty query matches everything", () => expect(score("", "anything")).toBeGreaterThan(0));
  it("prefix beats word start beats inside beats scattered letters", () => {
    const p = score("auto", "Automations");
    const w = score("auto", "Open automations");
    const i = score("tom", "Automations");
    const s = score("atn", "Automations");
    expect(p).toBeGreaterThan(w);
    expect(w).toBeGreaterThan(i);
    expect(i).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(0);
  });
  it("every word must match", () => {
    expect(score("new chat", "New chat")).toBeGreaterThan(0);
    expect(score("new zebra", "New chat")).toBe(0);
  });
  it("is case-insensitive and 0 when nothing matches", () => {
    expect(score("STRIPE", "stripe pricing")).toBeGreaterThan(0);
    expect(score("xyz", "stripe")).toBe(0);
  });
  it("shorter text wins among equal matches", () => expect(score("pay", "Pay")).toBeGreaterThan(score("pay", `Pay${" later".repeat(20)}`)));
});

describe("matchRanges", () => {
  it("marks each word's first occurrence, merged and sorted", () => {
    expect(matchRanges("new chat", "A New Chat")).toEqual([[2, 5], [6, 10]]);
    expect(matchRanges("chat new", "New x Chat")).toEqual([[0, 3], [6, 10]]);
  });
  it("overlapping words merge", () => expect(matchRanges("auto tom", "Automations")).toEqual([[0, 5]]));
  it("no match, no ranges", () => { expect(matchRanges("zzz", "abc")).toEqual([]); expect(matchRanges("", "abc")).toEqual([]); });
});

describe("rank", () => {
  const entries = [{ label: "Artifacts" }, { label: "Automations", keywords: "schedule cron" }, { label: "New chat" }, { label: "Open dashboard", keywords: "charts verdicts" }];
  it("orders by score, keeps input order for ties, and drops non-matches", () => {
    expect(rank("a", entries).map((e) => e.label)).toEqual(["Artifacts", "Automations", "New chat", "Open dashboard"]);
    expect(rank("zzz", entries)).toEqual([]);
  });
  it("matches keywords too, but a label match ranks above a keyword match", () => {
    expect(rank("schedule", entries).map((e) => e.label)).toEqual(["Automations"]);
    expect(rank("charts", [{ label: "Charts", keywords: "" }, { label: "Dashboard", keywords: "charts" }]).map((e) => e.label)).toEqual(["Charts", "Dashboard"]);
  });
  it("scattered-letter matches are dropped when real matches exist, kept when they are all there is", () => {
    const list = [{ label: "Automations" }, { label: "P3: capture when page mentions documentation examples" }];
    expect(rank("auto", list).map((e) => e.label)).toEqual(["Automations"]);
    expect(rank("atn", list).map((e) => e.label)).toContain("Automations");
  });
  it("with no query returns everything up to the limit", () => expect(rank("", entries, 2)).toHaveLength(2));
});
