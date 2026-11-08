import { z } from "zod";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn, type CapabilityId } from "./registry";
import type { AdapterResult } from "./types";

export type ChatProvider = Extract<CapabilityId, "groq" | "openrouter">;
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
};

/**
 * FREE ONLY. The allowlist is the only way a model id reaches the wire.
 * Groq: the free-plan chat models listed on console.groq.com/docs/rate-limits (checked 2026-11-08).
 * OpenRouter: ids ending in ":free", plus the free router. Anything else is refused before any request is made.
 */
export const GROQ_FREE_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"] as const;
export const OPENROUTER_FREE_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "openrouter/free",
] as const;

export function isFreeModel(provider: ChatProvider, model: string): boolean {
  return provider === "groq"
    ? (GROQ_FREE_MODELS as readonly string[]).includes(model)
    : (OPENROUTER_FREE_MODELS as readonly string[]).includes(model) && (model.endsWith(":free") || model === "openrouter/free");
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
  if (!isFreeModel(provider, model)) return degrade(`${provider}: ${model} is not on the free allowlist`);
  return guard(provider, async () => {
    const env = getEnv();
    const key = provider === "groq" ? env.GROQ_API_KEY : env.OPENROUTER_API_KEY;
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
