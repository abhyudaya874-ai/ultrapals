import { z } from "zod";
import { getEnv, type Env } from "@/lib/env";
import { degrade, guard, isOn, type CapabilityId } from "./registry";
import type { AdapterResult } from "./types";

export type ChatProvider = Extract<CapabilityId, "groq" | "openrouter" | "nvidia" | "tokenrouter" | "bluesminds" | "gemini">;
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatDelta {
  reasoning?: string;
  content?: string;
  error?: string;
  /** Exact token counts, when the provider reports them (some do in the last chunk of a stream). */
  usage?: { prompt: number; completion: number };
}

const BASE: Record<ChatProvider, string> = {
  groq: "https://api.groq.com/openai/v1", // OpenAI-compatible chat completions (console.groq.com/docs)
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1", // NIM LLM APIs (docs.api.nvidia.com/nim/reference/llm-apis)
  tokenrouter: "https://api.tokenrouter.com/v1", // OpenAI-compatible gateway (tokenrouter.com; key probed live 2026-11-10)
  bluesminds: "https://api.bluesminds.com/v1", // OpenAI-compatible gateway (api.bluesminds.com/about)
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai", // Google AI Studio's OpenAI compatibility, Bearer key (aistudio.google.com/docs/openai, read 2026-11-14)
};

const KEY_OF: Record<ChatProvider, keyof Env> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  tokenrouter: "TOKENROUTER_API_KEY",
  bluesminds: "BLUESMINDS_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/**
 * ALLOWLIST ONLY. The allowlist is the only way a model id reaches the wire.
 * Groq: the free-plan chat models listed on console.groq.com/docs/rate-limits (checked 2026-11-08).
 * OpenRouter: ids ending in ":free", plus the free router.
 * NVIDIA / TokenRouter / Bluesminds: ids confirmed in each gateway's live /v1/models with the owner's key (2026-11-10).
 * Anything else is refused before any request is made.
 */
export const GROQ_FREE_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"] as const;
export const OPENROUTER_FREE_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "openrouter/free",
] as const;
// Live-probed 2026-11-12 with a planner-style JSON task on this account's key: Bolt 3.5 s, Super VL 8 s, Ultra 9 s, all usable; eight requests at once
// were all accepted. Not added: gpt-oss-20b, deepseek-v4.1-flash and glm-5.3-flash sent nothing for 60 s; minimax-m3.1-flash answered 503; gemma-4,
// kimi-k2.6, nemotron-3-super, nemotron-nano-3, llama-3.1-nemotron and mistral-large-2 are listed in /v1/models but answer 404 "not found for account".
export const NVIDIA_MODELS = ["nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia/nemotron-3.5-bolt-e4b"] as const;
export const TOKENROUTER_MODELS = ["x-ai/grok-4.1-fast", "deepseek/deepseek-v4.1-flash", "openai/gpt-oss-120b"] as const; // key valid, account balance $0 on 2026-11-10: recharge, then add to the roster
export const BLUESMINDS_MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "meta/muse-glimmer-30b",
] as const; // kimi-k3 is end-of-life, gpt-oss-20b timed out
/**
 * Google AI Studio (the Gemini API), FREE TIER ONLY. Each id says "Free of charge" in the Free Tier column of aistudio.google.com/docs/pricing (read
 * 2026-11-14) and answered a planner-style JSON task on this account's key in 1 to 4 s. The free tier's limits, from its own 429s: 15 requests a
 * minute per Flash-Lite model, and only 20 a day for gemini-3-flash-preview. Free but not added: gemini-3.8-flash and gemini-4-hydrogen
 * (503 "high demand", or 40 to 150 s before the first byte), gemini-3.6-flash (15 to 25 s), the Gemma 4 models (500s, and 16 s of thinking written into
 * the reply), the 2.5 models (404, "no longer available to new users"). Paid-only ids (gemini-4-carbon, gemini-4-argon, gemini-3.1-pro-preview) are
 * refused like anything else that is not listed. These stay free only while the key's Google project has no billing account linked.
 */
export const GEMINI_FREE_MODELS = ["gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

export function isAllowedModel(provider: ChatProvider, model: string): boolean {
  switch (provider) {
    case "groq":
      return (GROQ_FREE_MODELS as readonly string[]).includes(model);
    case "openrouter":
      return (OPENROUTER_FREE_MODELS as readonly string[]).includes(model) && (model.endsWith(":free") || model === "openrouter/free");
    case "nvidia":
      return (NVIDIA_MODELS as readonly string[]).includes(model);
    case "tokenrouter":
      return (TOKENROUTER_MODELS as readonly string[]).includes(model);
    case "bluesminds":
      return (BLUESMINDS_MODELS as readonly string[]).includes(model);
    case "gemini":
      return (GEMINI_FREE_MODELS as readonly string[]).includes(model);
  }
}

/**
 * Pure. The body of one streamed completion: the common fields, then what a provider needs. Gemini (aistudio.google.com/docs/openai, read 2026-11-14)
 * sends token counts only when asked (`stream_options`), and gets a short think whose summary is streamed (`thinking_config` inside `extra_body`;
 * `reasoning_effort` cannot be sent with it). Its thinking counts against max_tokens, so callers give those models room (tokenBudget).
 */
export function chatBody(provider: ChatProvider, model: string, messages: ChatMessage[], maxTokens: number): Record<string, unknown> {
  return {
    model,
    stream: true,
    messages,
    max_tokens: maxTokens,
    ...(provider === "groq" && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    ...(provider === "gemini"
      ? { stream_options: { include_usage: true }, extra_body: { google: { thinking_config: { thinking_level: "low", include_thoughts: true } } } }
      : {}),
  };
}

const THOUGHT_CLOSE = /^\s*<\/thought>/;
/** Pure. True when a chunk's `extra_content` says its text is thought summary (`{ google: { thought: true } }`). */
const isThought = (x: unknown): boolean => {
  const g = typeof x === "object" && x !== null ? (x as { google?: unknown }).google : undefined;
  return typeof g === "object" && g !== null && (g as { thought?: unknown }).thought === true;
};
/**
 * Pure. Gemini streams its thought summary as reply text: "<thought>…" in chunks flagged `extra_content.google.thought`, then "</thought>" at the start
 * of the first chunk of the answer (seen live 2026-11-14 on gemini-3-flash-preview and gemma-4-26b-a4b-it). Splits one chunk's text into the two.
 */
export function splitThought(content: string, flagged: boolean): { thought: string; text: string } {
  if (!flagged) return { thought: "", text: content.replace(THOUGHT_CLOSE, "") };
  const close = content.indexOf("</thought>");
  const thought = (close < 0 ? content : content.slice(0, close)).replace(/^\s*<thought>/, "");
  return { thought, text: close < 0 ? "" : content.slice(close + "</thought>".length) };
}

const Chunk = z.object({
  // Providers name the thinking differently: `reasoning` (OpenRouter, Groq) or `reasoning_content` (NVIDIA, Bluesminds and other OpenAI-compatible hosts)
  // Gemini flags a chunk of thought summary with extra_content.google.thought (its text still arrives as `content`). Read leniently (isThought), so a
  // shape Google changes later cannot make the whole chunk, and the words in it, fail to parse.
  choices: z.array(z.object({ delta: z.object({ content: z.string().nullish(), reasoning: z.string().nullish(), reasoning_content: z.string().nullish(), extra_content: z.unknown().optional() }).optional() })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).nullish(),
  x_groq: z.object({ usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).nullish() }).nullish(),
});

/**
 * Pure. Feed it the accumulated text; it returns the deltas in every COMPLETE event plus the unfinished tail.
 * Skips `: OPENROUTER PROCESSING` style comment lines, tolerates junk, flags `[DONE]`.
 */
export function parseChatSse(buffer: string): { deltas: ChatDelta[]; rest: string; done: boolean } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const deltas: ChatDelta[] = [];
  let done = false;
  for (const ev of parts) {
    const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const c = Chunk.safeParse(json);
    if (!c.success) continue;
    if (c.data.error) deltas.push({ error: c.data.error.message ?? "stream error" });
    const d = c.data.choices?.[0]?.delta;
    const think = d?.reasoning || d?.reasoning_content;
    if (think) deltas.push({ reasoning: think });
    if (d?.content) {
      const s = splitThought(d.content, isThought(d.extra_content));
      if (s.thought) deltas.push({ reasoning: s.thought });
      if (s.text) deltas.push({ content: s.text });
    }
    const u = c.data.usage ?? c.data.x_groq?.usage;
    // Gemini leaves its thinking out of completion_tokens but counts it in total_tokens; the other providers' totals are prompt plus completion
    if (u && typeof u.prompt_tokens === "number") deltas.push({ usage: { prompt: u.prompt_tokens, completion: Math.max(u.completion_tokens ?? 0, typeof u.total_tokens === "number" ? u.total_tokens - u.prompt_tokens : 0) } });
  }
  return { deltas, rest, done };
}

/**
 * Pure. Why a request failed, in words the router reads: "groq http 429", and for a rate limit how long to wait ("retry 7s", from the Retry-After
 * header or the provider's own "try again in 7.34s") and whether the limit is a day's ("daily", as OpenRouter's free models say). Groq's free plan
 * allows 8,000 tokens a minute per model, so a busy minute hits this often and clears in seconds; a model that is benched for a whole minute instead
 * pushes every call onto slower ones.
 */
export function failureReason(provider: ChatProvider, status: number, retryAfter: string | null, body: string): string {
  const base = `${provider} http ${status}`;
  if (status !== 429) return base;
  let sec = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN;
  if (!Number.isFinite(sec)) {
    const m = /try again in (?:(\d+)m(?=\d))?(?:(\d+(?:\.\d+)?)(ms|s))?/i.exec(body);
    if (m && (m[1] || m[2])) sec = Number(m[1] ?? 0) * 60 + (m[2] ? (m[3]?.toLowerCase() === "ms" ? Number(m[2]) / 1000 : Number(m[2])) : 0);
  }
  // Gemini (a real 429, 2026-11-14): no Retry-After header; "Please retry in 57.109471s." in the message and "retryDelay": "57s" in RetryInfo
  if (!Number.isFinite(sec)) {
    const g = /retry in (\d+(?:\.\d+)?)(ms|s)\b/i.exec(body) ?? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)(s)"/.exec(body);
    if (g) sec = g[2].toLowerCase() === "ms" ? Number(g[1]) / 1000 : Number(g[1]);
  }
  // Gemini names the limit it hit in its quota id ("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"; the daily one says PerDay)
  const daily = /per[- ]?day|daily/i.test(body);
  return `${base}${Number.isFinite(sec) ? ` retry ${Math.max(1, Math.ceil(sec))}s` : ""}${daily ? " daily" : ""}`;
}

/** Opens a streaming completion. The caller reads `body` and feeds it to parseChatSse. 4xx/5xx/429 degrade so the router can fall back. */
export async function openChat(
  provider: ChatProvider,
  model: string,
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; maxTokens?: number } = {},
): Promise<AdapterResult<{ provider: ChatProvider; model: string; body: ReadableStream<Uint8Array> }>> {
  if (!isOn(provider)) return degrade(`${provider} off`);
  if (!isAllowedModel(provider, model)) return degrade(`${provider}: ${model} is not on the allowlist`);
  return guard(provider, async () => {
    const env = getEnv();
    const key = env[KEY_OF[provider]];
    const signals = [AbortSignal.timeout(60_000), ...(opts.signal ? [opts.signal] : [])];
    const res = await fetch(`${BASE[provider]}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key ?? ""}` },
      body: JSON.stringify(chatBody(provider, model, messages, opts.maxTokens ?? 1200)),
      signal: AbortSignal.any(signals),
    });
    if (!res.ok || !res.body) {
      // A rate limit says when to come back and whether the limit is a day's; read both, so the router waits as long as it must and no longer.
      const hint = res.status === 429 ? await res.text().catch(() => "") : "";
      return degrade(failureReason(provider, res.status, res.headers.get("retry-after"), hint));
    }
    return { ok: true, data: { provider, model, body: res.body } };
  });
}

/** Reads a streamed completion body as deltas. Pure transport: no vendor call, so it lives beside the parser. */
export async function* readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatDelta> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const p = parseChatSse((buf += dec.decode(value, { stream: true })));
      buf = p.rest;
      yield* p.deltas;
      if (p.done) return;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
