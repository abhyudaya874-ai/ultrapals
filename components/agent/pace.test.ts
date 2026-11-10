import { describe, expect, it } from "vitest";
import type { CEvent } from "@/lib/computer/events";
import { CHUNK_CHARS, chunkDelay, expandEvent, paceDelay } from "./pace";

const file: CEvent = { kind: "file", agent: "a", id: "f", path: "/p", created: true, adds: 1, removes: 0, preview: "" };

describe("paceDelay", () => {
  it("files come one at a time, steps and visits quicker", () => {
    expect(paceDelay(file, 0)).toBe(420);
    expect(paceDelay({ kind: "visit", agent: "a", id: "v", action: "read", label: "x", state: "ok" }, 0)).toBe(150);
    expect(paceDelay({ kind: "step", agent: "a", id: "s", label: "x", state: "ok" }, 0)).toBe(70);
  });
  it("text streams, tool output and the end are never delayed", () => {
    for (const e of [{ kind: "answer", delta: "x" }, { kind: "reasoning", agent: "a", delta: "x" }, { kind: "term", agent: "a", id: "t", command: "ls", state: "ok" }, { kind: "done", used: [], model: "m", ms: 1 }, { kind: "error", message: "x" }] as CEvent[]) expect(paceDelay(e, 0)).toBe(0);
  });
  it.each([[0, 420], [6, 420], [7, 210], [16, 210], [17, 84], [40, 84], [41, 0], [500, 0]])("backlog %i -> %ims", (n, ms) => expect(paceDelay(file, n)).toBe(ms));
  it("a backlog can never make the delay negative or larger than the base", () => {
    for (let n = 0; n < 100; n++) { const d = paceDelay(file, n); expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(420); }
  });
});

describe("expandEvent", () => {
  const text = "Stripe has the lowest fee for a five dollar sale, PayPal is slightly higher, and Square sits in the middle of the three.";
  it("leaves short deltas and other events alone", () => {
    const short: CEvent = { kind: "answer", delta: "short text" };
    expect(expandEvent(short)).toEqual([short]);
    expect(expandEvent(file)).toEqual([file]);
  });
  it("cuts a long delta into small pieces that join back to the same text", () => {
    const parts = expandEvent({ kind: "answer", delta: text });
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.map((p) => (p.kind === "answer" ? p.delta : "")).join("")).toBe(text);
    for (const p of parts) expect(p.kind === "answer" && p.delta.length <= CHUNK_CHARS * 1.5 + 1).toBe(true);
  });
  it("cuts on word boundaries when it can, and still terminates on text with no spaces", () => {
    const parts = expandEvent({ kind: "answer", delta: "x".repeat(300) });
    expect(parts.map((p) => (p.kind === "answer" ? p.delta : "")).join("")).toBe("x".repeat(300));
    expect(parts.length).toBeGreaterThan(5);
  });
  it("only split answer pieces get a pause", () => {
    expect(chunkDelay({ kind: "answer", delta: "x" }, true)).toBe(14);
    expect(chunkDelay({ kind: "answer", delta: "x" }, false)).toBe(0);
    expect(chunkDelay(file, true)).toBe(0);
  });
});
