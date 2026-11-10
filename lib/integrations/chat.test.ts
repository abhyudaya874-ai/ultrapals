import { describe, expect, it } from "vitest";
import { BLUESMINDS_MODELS, GROQ_FREE_MODELS, NVIDIA_MODELS, OPENROUTER_FREE_MODELS, TOKENROUTER_MODELS, isAllowedModel, parseChatSse } from "./chat";

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (d: object) => ev({ choices: [{ index: 0, delta: d }] });

describe("parseChatSse", () => {
  it("splits reasoning from content (shapes probed live on groq and openrouter)", () => {
    const buf = delta({ role: "assistant", content: "" }) + delta({ reasoning: "Need", channel: "analysis" }) + delta({ content: "Id" }) + "data: [DONE]\n\n";
    expect(parseChatSse(buf)).toEqual({ deltas: [{ reasoning: "Need" }, { content: "Id" }], rest: "", done: true });
  });
  it("skips openrouter comment lines and keeps the unfinished tail", () => {
    const r = parseChatSse(": OPENROUTER PROCESSING\n\n" + delta({ content: "a" }) + 'data: {"choices":[{"delta":{"con');
    expect(r.deltas).toEqual([{ content: "a" }]);
    expect(r.rest).toBe('data: {"choices":[{"delta":{"con');
    expect(r.done).toBe(false);
  });
  it("is resumable: tail + more bytes yields the delta exactly once", () => {
    const whole = delta({ content: "xy" });
    const a = parseChatSse(whole.slice(0, 20));
    expect(a.deltas).toEqual([]);
    expect(parseChatSse(a.rest + whole.slice(20)).deltas).toEqual([{ content: "xy" }]);
  });
  it("surfaces an in-stream error and ignores junk", () => {
    expect(parseChatSse(ev({ error: { message: "rate limited" } }) + "data: not json\n\n").deltas).toEqual([{ error: "rate limited" }]);
  });
  it("handles CRLF event separators", () => {
    expect(parseChatSse('data: {"choices":[{"delta":{"content":"z"}}]}\r\n\r\n').deltas).toEqual([{ content: "z" }]);
  });
});

describe("provider allowlist", () => {
  it("accepts every listed model on its own provider", () => {
    for (const m of GROQ_FREE_MODELS) expect(isAllowedModel("groq", m)).toBe(true);
    for (const m of OPENROUTER_FREE_MODELS) expect(isAllowedModel("openrouter", m)).toBe(true);
    for (const m of NVIDIA_MODELS) expect(isAllowedModel("nvidia", m)).toBe(true);
    for (const m of TOKENROUTER_MODELS) expect(isAllowedModel("tokenrouter", m)).toBe(true);
    for (const m of BLUESMINDS_MODELS) expect(isAllowedModel("bluesminds", m)).toBe(true);
  });
  it("refuses unlisted models and cross-provider ids", () => {
    expect(isAllowedModel("openrouter", "openai/gpt-4o")).toBe(false);
    expect(isAllowedModel("openrouter", "anthropic/claude-opus-4")).toBe(false);
    expect(isAllowedModel("groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(isAllowedModel("groq", "nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(false);
    expect(isAllowedModel("nvidia", "openai/gpt-oss-120b")).toBe(false);
    expect(isAllowedModel("tokenrouter", "anthropic/claude-opus-5.5")).toBe(false);
    expect(isAllowedModel("bluesminds", "nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
  });
  it("every OpenRouter entry is ':free' or the free router", () => {
    for (const m of OPENROUTER_FREE_MODELS) expect(m.endsWith(":free") || m === "openrouter/free").toBe(true);
  });
});
