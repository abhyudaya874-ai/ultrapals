import { describe, expect, it } from "vitest";
import { MAIN_SYSTEM } from "@/lib/computer/main-actions";
import { PICKABLE } from "@/lib/computer/models";
import { defaultModelDeps } from "@/lib/computer/model";
import { DEFAULT_WINDOW, MAIN_BASELINE_TOKENS, SMALLEST_WINDOW, WINDOWS, contextWindow, estimateTokens, fillOf, formatTokens, messagesTokens, percentLabel, percentOf, usageFor } from "./tokens";

describe("estimateTokens", () => {
  it("is zero for nothing, and at least one token for anything", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
  });
  it("English prose is about four characters a token", () => {
    const t = "The quick brown fox jumps over the lazy dog while the sun sets over the quiet hills of the valley.";
    expect(estimateTokens(t)).toBeGreaterThan(t.length / 5);
    expect(estimateTokens(t)).toBeLessThan(t.length / 3.6);
  });
  it("punctuation-heavy text (JSON, code) takes more tokens per character than prose", () => {
    const prose = "word ".repeat(80);
    const json = JSON.stringify({ a: [1, 2, { b: "x", c: [3, 4] }], d: { e: null, f: [true, false] } }).repeat(6);
    expect(estimateTokens(json) / json.length).toBeGreaterThan(estimateTokens(prose) / prose.length);
  });
  it("never assumes fewer than 2.8 characters a token, however much punctuation there is", () => {
    const junk = "{}[]()<>;:,.".repeat(50);
    expect(estimateTokens(junk)).toBeLessThanOrEqual(Math.ceil(junk.length / 2.8));
    expect(estimateTokens(junk)).toBeGreaterThanOrEqual(Math.floor(junk.length / 2.8) - 1);
  });
  it("text that is not English takes more tokens per character", () => {
    expect(estimateTokens("你好世界".repeat(20))).toBeGreaterThan(estimateTokens("abcd".repeat(20)));
  });
  it("grows with the text and never goes backwards", () => {
    let prev = 0;
    for (const n of [1, 5, 20, 100, 400, 1600]) {
      const t = estimateTokens("some words here ".repeat(n));
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
  // Exact counts Groq reported (2026-11-10) for the same strings, as the calibration check that keeps this honest.
  it.each([
    ["Answer in one short sentence.\n---\nWhat is the capital of France? Add the word done.", 92 - 72], // gpt-oss adds about 72 tokens of its own template
  ])("is in the right region for a real prompt: %j", (text, groq) => {
    const est = estimateTokens(text) + 6;
    expect(Math.abs(est - groq)).toBeLessThanOrEqual(12);
  });
});

describe("messagesTokens", () => {
  it("adds a little for each message and for the request", () => {
    const one = messagesTokens([{ content: "hello" }]);
    expect(one).toBe(estimateTokens("hello") + 4 + 8);
    expect(messagesTokens([{ content: "hello" }, { content: "world" }])).toBe(estimateTokens("hello") + estimateTokens("world") + 8 + 8);
    expect(messagesTokens([])).toBe(8);
  });
});

describe("the baseline for UltraPal", () => {
  it("is within 10% of what its real instructions measure, so a ring drawn before the first call is not a made-up number", () => {
    const real = messagesTokens([{ content: MAIN_SYSTEM }]);
    expect(Math.abs(MAIN_BASELINE_TOKENS - real) / real).toBeLessThanOrEqual(0.1);
  });
});

describe("contextWindow", () => {
  it("knows every model the app can call", () => {
    for (const m of defaultModelDeps.models) expect(WINDOWS[m.model], `${m.provider}:${m.model} has no listed window`).toBeDefined();
    for (const p of PICKABLE) expect(WINDOWS[p.model], `${p.model} has no listed window`).toBeDefined();
  });
  it("uses the ids as they are, :free included (the free tier of a model can hold more than the paid one)", () => {
    expect(contextWindow("openai/gpt-oss-120b")).toBe(131_072);
    expect(contextWindow("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(1_000_000);
    expect(contextWindow("nvidia/nemotron-3-ultra-550b-a55b")).toBe(262_144);
  });
  it("gives a model nobody listed a common size rather than zero", () => expect(contextWindow("acme/unknown-1")).toBe(DEFAULT_WINDOW));
  it("the smallest window on the roster is the one a ring is drawn against before any model has answered", () => {
    expect(SMALLEST_WINDOW).toBe(Math.min(...defaultModelDeps.models.map((m) => contextWindow(m.model))));
  });
});

describe("usageFor", () => {
  const base = { messages: [{ content: "Answer briefly." }, { content: "What is 2+2?" }], text: "Four.", model: "openai/gpt-oss-120b", provider: "groq" };
  it("uses the provider's own numbers when it sent both, and says so", () => {
    expect(usageFor({ ...base, counted: { prompt: 92, completion: 27 } })).toEqual({ prompt: 92, completion: 27, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true });
  });
  it("estimates from the text when it sent none, counting the thinking too", () => {
    const u = usageFor({ ...base, thought: "x".repeat(400) });
    expect(u.exact).toBe(false);
    expect(u.prompt).toBe(messagesTokens(base.messages));
    expect(u.completion).toBe(estimateTokens("Four.") + estimateTokens("x".repeat(400)));
  });
  it("a count with no reply tokens is only half known: the prompt is kept, the reply is estimated, and it is not called exact", () => {
    const u = usageFor({ ...base, counted: { prompt: 55, completion: 0 } });
    expect(u).toMatchObject({ prompt: 55, exact: false });
    expect(u.completion).toBe(estimateTokens("Four."));
  });
  it("a count of zero is no count", () => expect(usageFor({ ...base, counted: { prompt: 0, completion: 0 } }).exact).toBe(false));
});

describe("how a ring reads", () => {
  it.each([[0, "0"], [7, "7"], [950, "950"], [1_200, "1.2K"], [9_999, "10K"], [10_000, "10K"], [362_000, "362K"], [131_072, "131K"], [1_000_000, "1M"], [1_200_000, "1.2M"], [-5, "0"]])("%i is %s", (n, want) => expect(formatTokens(n)).toBe(want));
  it("percent is whole and capped; a little is '<1%', nothing is '0%'", () => {
    expect(percentOf(362_000, 1_000_000)).toBe(36);
    expect(percentOf(2_000_000, 1_000_000)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentLabel(0, 131_072)).toBe("0%");
    expect(percentLabel(200, 131_072)).toBe("<1%");
    expect(percentLabel(65_536, 131_072)).toBe("50%");
  });
  it("turns amber at 70% and red at 90%", () => {
    expect([0, 69, 70, 89, 90, 100].map(fillOf)).toEqual(["calm", "calm", "warn", "warn", "full", "full"]);
  });
});
