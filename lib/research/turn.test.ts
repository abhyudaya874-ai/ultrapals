import { describe, expect, it } from "vitest";
import type { ResearchEvent } from "./run";
import type { Source } from "./sources";
import { applyEvent, newTurn, parseResearchStream } from "./turn";

const src: Source = { n: 1, host: "a.example", url: "https://a.example/1", title: "A", snippet: "s", publishedDate: null, provider: "tavily", score: null };
const run = (evs: ResearchEvent[]) => evs.reduce(applyEvent, newTurn("t1", "q?"));

describe("applyEvent", () => {
  it("folds a whole run into one turn", () => {
    const t = run([
      { kind: "step", id: "s1", label: "Searching", state: "running" },
      { kind: "step", id: "s1", label: "Searched", state: "ok", detail: "6 results", ms: 900 },
      { kind: "sources", sources: [src] },
      { kind: "reasoning", delta: "th" }, { kind: "reasoning", delta: "ink" },
      { kind: "answer", delta: "Yes " }, { kind: "answer", delta: "[1]" },
      { kind: "done", used: [1], provider: "groq", model: "openai/gpt-oss-120b", ms: 3300 },
    ]);
    expect(t.steps).toEqual([{ id: "s1", label: "Searched", state: "ok", detail: "6 results", ms: 900 }]);
    expect(t).toMatchObject({ reasoning: "think", answer: "Yes [1]", sources: [src], used: [1], status: "done", model: "gpt-oss-120b · groq", ms: 3300 });
  });
  it("keeps step order and supersedes in place", () => {
    const t = run([
      { kind: "step", id: "a", label: "A", state: "running" }, { kind: "step", id: "b", label: "B", state: "running" },
      { kind: "step", id: "a", label: "A", state: "error", detail: "429" },
    ]);
    expect(t.steps.map((s) => [s.id, s.state])).toEqual([["a", "error"], ["b", "running"]]);
  });
  it("records an error and leaves the partial answer alone", () => {
    expect(run([{ kind: "answer", delta: "part" }, { kind: "error", message: "busy" }])).toMatchObject({ status: "error", error: "busy", answer: "part" });
  });
  it("does not mutate the previous turn", () => {
    const a = newTurn("t", "q");
    applyEvent(a, { kind: "answer", delta: "x" });
    expect(a.answer).toBe("");
  });
});

describe("parseResearchStream", () => {
  const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  it("parses complete events and keeps the tail", () => {
    const r = parseResearchStream(ev({ kind: "answer", delta: "a" }) + 'data: {"kind":"ans');
    expect(r.events).toEqual([{ kind: "answer", delta: "a" }]);
    expect(r.rest).toBe('data: {"kind":"ans');
  });
  it("skips junk and objects without a kind", () => {
    expect(parseResearchStream("data: nope\n\n" + ev({ x: 1 }) + ev({ kind: "error", message: "m" })).events).toEqual([{ kind: "error", message: "m" }]);
  });
});
