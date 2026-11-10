import { z } from "zod";
import { getEnv, type Env } from "@/lib/env";
import { degrade, guard, isOn, type CapabilityId } from "./registry";
import type { AdapterResult } from "./types";

export type ChatProvider = Extract<CapabilityId, "groq" | "openrouter" | "nvidia" | "tokenrouter" | "bluesminds">;
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatDelta {
  reasoning?: string;
  content?: string;
  error?: string;
}

const BASE: Record<ChatProvider, string> = {
  groq: "https://api.groq.com/openai/v1", // OpenAI-compatible chat completions (console.groq.com/docs)
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1", // NIM LLM APIs (docs.api.nvidia.com/nim/reference/llm-apis)
  tokenrouter: "https://api.tokenrouter.com/v1", // OpenAI-compatible gateway (tokenrouter.com; key probed live 2026-11-10)
  bluesminds: "https://api.bluesminds.com/v1", // OpenAI-compatible gateway (api.bluesminds.com/about)
};

const KEY_OF: Record<ChatProvider, keyof Env> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  tokenrouter: "TOKENROUTER_API_KEY",
  bluesminds: "BLUESMINDS_API_KEY",
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
export const NVIDIA_MODELS = ["deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "moonshotai/kimi-k2.6"] as const;
export const TOKENROUTER_MODELS = ["x-ai/grok-4.1-fast", "deepseek/deepseek-v4.1-flash", "openai/gpt-oss-120b"] as const;
export const BLUESMINDS_MODELS = ["nvidia/nemotron-3.5-lightning-30b-a3b", "moonshotai/kimi-k3", "openai/gpt-oss-20b"] as const;

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
  }
}

const Chunk = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().nullish(), reasoning: z.string().nullish() }).optional() })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
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
    if (d?.reasoning) deltas.push({ reasoning: d.reasoning });
    if (d?.content) deltas.push({ content: d.content });
  }
  return { deltas, rest, done };
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
      body: JSON.stringify({
        model,
        stream: true,
        messages,
        max_tokens: opts.maxTokens ?? 1200,
        ...(provider === "groq" && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.any(signals),
    });
    if (!res.ok || !res.body) return degrade(`${provider} http ${res.status}`);
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
