import { describe, expect, it } from "vitest";
import { BLUESMINDS_MODELS, GEMINI_FREE_MODELS, GROQ_FREE_MODELS, NVIDIA_MODELS, OPENROUTER_FREE_MODELS, TOKENROUTER_MODELS, chatBody, failureReason, isAllowedModel, parseChatSse, splitThought } from "./chat";

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
    expect(isAllowedModel("bluesminds", "moonshotai/kimi-k3")).toBe(false);
    expect(isAllowedModel("nvidia", "meta/llama-3.3-70b-instruct")).toBe(false);
  });
  it("every OpenRouter entry is ':free' or the free router", () => {
    for (const m of OPENROUTER_FREE_MODELS) expect(m.endsWith(":free") || m === "openrouter/free").toBe(true);
  });
});

describe("providers that name the thinking reasoning_content, and that report usage", () => {
  const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  it("reads reasoning_content as reasoning (NVIDIA, Bluesminds)", () => {
    const p = parseChatSse(chunk({ choices: [{ delta: { role: "assistant", reasoning_content: "Let me think" } }] }) + chunk({ choices: [{ delta: { content: "{\"action\":\"scroll\"}" } }] }));
    expect(p.deltas).toEqual([{ reasoning: "Let me think" }, { content: '{"action":"scroll"}' }]);
  });
  it("still reads reasoning (OpenRouter, Groq), and prefers it when both are present", () => {
    expect(parseChatSse(chunk({ choices: [{ delta: { reasoning: "a" } }] })).deltas).toEqual([{ reasoning: "a" }]);
    expect(parseChatSse(chunk({ choices: [{ delta: { reasoning: "a", reasoning_content: "b" } }] })).deltas).toEqual([{ reasoning: "a" }]);
  });
  it("reads the exact token counts a provider sends in the last chunk", () => {
    const p = parseChatSse(chunk({ choices: [], usage: { prompt_tokens: 55, completion_tokens: 400, total_tokens: 455 } }));
    expect(p.deltas).toEqual([{ usage: { prompt: 55, completion: 400 } }]);
  });
  it("reads Groq's counts from x_groq", () => {
    expect(parseChatSse(chunk({ choices: [{ delta: {}, finish_reason: "stop" }], x_groq: { usage: { prompt_tokens: 77, completion_tokens: 30 } } })).deltas).toEqual([{ usage: { prompt: 77, completion: 30 } }]);
  });
  it("a null usage on ordinary chunks adds nothing", () => {
    expect(parseChatSse(chunk({ choices: [{ delta: { content: "hi" } }], usage: null })).deltas).toEqual([{ content: "hi" }]);
  });
});

describe("failureReason: what the router is told when a request is refused", () => {
  it("is just the status for anything but a rate limit", () => {
    expect(failureReason("groq", 500, "30", "try again in 5s")).toBe("groq http 500");
    expect(failureReason("bluesminds", 404, null, "")).toBe("bluesminds http 404");
  });
  it("reads when a rate limit clears from the Retry-After header first", () => {
    expect(failureReason("groq", 429, "7", "")).toBe("groq http 429 retry 7s");
    expect(failureReason("groq", 429, "2.2", "try again in 30s")).toBe("groq http 429 retry 3s");
  });
  it("reads it from Groq's own words when there is no header, in seconds, milliseconds, or minutes and seconds", () => {
    const body = (when: string) => `Rate limit reached for model openai/gpt-oss-120b on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2500. Please try again in ${when}. Need more tokens?`;
    expect(failureReason("groq", 429, null, body("7.34s"))).toBe("groq http 429 retry 8s");
    expect(failureReason("groq", 429, null, body("850ms"))).toBe("groq http 429 retry 1s");
    expect(failureReason("groq", 429, null, body("6m23.4s"))).toBe("groq http 429 retry 384s");
  });
  it("says so when the limit is for the day, as OpenRouter's free models do", () => {
    const body = JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day" } });
    expect(failureReason("openrouter", 429, null, body)).toBe("openrouter http 429 daily");
  });
  it("is still just the status when a rate limit says nothing about when", () => {
    expect(failureReason("nvidia", 429, null, "slow down")).toBe("nvidia http 429");
  });
});

describe("Google AI Studio (Gemini API), free tier only", () => {
  it("allows the free models it lists and nothing else on that provider", () => {
    for (const m of GEMINI_FREE_MODELS) expect(isAllowedModel("gemini", m)).toBe(true);
    // paid-only on the free tier ("Not available" in the pricing page's Free Tier column, 2026-11-14)
    for (const m of ["gemini-4-carbon", "gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3-pro-image"]) expect(isAllowedModel("gemini", m)).toBe(false);
    // a moving alias, a prefixed id and another provider's model are refused too
    for (const m of ["gemini-flash-latest", "models/gemini-3-flash-preview", "openai/gpt-oss-120b"]) expect(isAllowedModel("gemini", m)).toBe(false);
    expect(isAllowedModel("groq", "gemini-3-flash-preview")).toBe(false);
  });
  it("asks Gemini for token counts and a short, summarised think; nothing Gemini-only goes to anyone else", () => {
    const g = chatBody("gemini", "gemini-3-flash-preview", [{ role: "user", content: "x" }], 900);
    expect(g).toMatchObject({ model: "gemini-3-flash-preview", stream: true, max_tokens: 900, stream_options: { include_usage: true }, extra_body: { google: { thinking_config: { thinking_level: "low", include_thoughts: true } } } });
    expect(g).not.toHaveProperty("reasoning_effort"); // Google refuses it next to thinking_config
    const groq = chatBody("groq", "openai/gpt-oss-120b", [], 900);
    expect(groq).toMatchObject({ reasoning_effort: "low" });
    expect(groq).not.toHaveProperty("extra_body");
    expect(groq).not.toHaveProperty("stream_options");
    expect(chatBody("nvidia", "nvidia/nemotron-3-ultra-550b-a55b", [], 900)).not.toHaveProperty("reasoning_effort");
  });
  // the chunks below are copied from a live stream of gemini-3-flash-preview (2026-11-14), ids and timestamps trimmed
  const thought = { choices: [{ delta: { content: "<thought>**Defining Prime Numbers**\n\nI'm focusing on the number 91.\n\n\n", extra_content: { google: { thought: true } }, role: "assistant" }, index: 0 }] };
  const answer = { choices: [{ delta: { content: "</thought>No", role: "assistant" }, index: 0 }] };
  const rest = { choices: [{ delta: { content: ". It is 7 × 13.", role: "assistant" }, index: 0 }] };
  const signature = { choices: [{ delta: { extra_content: { google: { thought_signature: "EqAKCp0K" } }, role: "assistant" }, finish_reason: "stop", index: 0 }], usage: { completion_tokens: 46, prompt_tokens: 79, total_tokens: 420 } };
  it("turns the thought summary into thinking and keeps the tags out of the answer", () => {
    expect(parseChatSse([thought, answer, rest].map(ev).join("")).deltas).toEqual([{ reasoning: "**Defining Prime Numbers**\n\nI'm focusing on the number 91.\n\n\n" }, { content: "No" }, { content: ". It is 7 × 13." }]);
  });
  it("handles a think that runs over several chunks (Gemma) and one that closes inside its own chunk", () => {
    const a = { choices: [{ delta: { content: "<thought>The user wants", extra_content: { google: { thought: true } } } }] };
    const b = { choices: [{ delta: { content: " a number.", extra_content: { google: { thought: true } } } }] };
    const c = { choices: [{ delta: { content: '</thought>{"action":"answer"}' } }] };
    expect(parseChatSse([a, b, c].map(ev).join("")).deltas).toEqual([{ reasoning: "The user wants" }, { reasoning: " a number." }, { content: '{"action":"answer"}' }]);
    expect(splitThought("<thought>short</thought>Yes", true)).toEqual({ thought: "short", text: "Yes" });
  });
  it("counts the thinking in the reply's tokens, as Google's total does", () => {
    expect(parseChatSse(ev(signature)).deltas).toEqual([{ usage: { prompt: 79, completion: 341 } }]);
    // a provider whose total is prompt plus completion is unchanged
    expect(parseChatSse(ev({ choices: [], usage: { prompt_tokens: 55, completion_tokens: 400, total_tokens: 455 } })).deltas).toEqual([{ usage: { prompt: 55, completion: 400 } }]);
  });
  it("keeps the words when extra_content arrives in a shape it does not know", () => {
    expect(parseChatSse(ev({ choices: [{ delta: { content: "hi", extra_content: { google: "new" } } }] })).deltas).toEqual([{ content: "hi" }]);
  });
  // the body of a real 429 from a burst of 22 requests at gemini-3.1-flash-lite (2026-11-14), shortened; Google sends no Retry-After header
  const limited = (quotaId: string) => JSON.stringify([{ error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details. ...\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.1-flash-lite\nPlease retry in 57.109471s.", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue: "15" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "57s" }] } }]);
  it("reads when Google's per-minute limit clears, and benches that model for as long", () => {
    expect(failureReason("gemini", 429, null, limited("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"))).toBe("gemini http 429 retry 58s");
    expect(failureReason("gemini", 429, null, JSON.stringify({ error: { details: [{ retryDelay: "12s" }] } }))).toBe("gemini http 429 retry 12s");
  });
  it("says so when it is the day's limit", () => {
    expect(failureReason("gemini", 429, null, limited("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toBe("gemini http 429 retry 58s daily");
  });
});
