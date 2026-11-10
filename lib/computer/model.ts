import { openChat, readDeltas, type ChatMessage, type ChatProvider } from "@/lib/integrations/chat";
import type { CEvent } from "./events";

export interface ModelRef {
  provider: ChatProvider;
  model: string;
}
export interface ModelDeps {
  open: typeof openChat;
  models: ModelRef[];
  now: () => number;
}

/** Fastest first, spread across all five providers so one rate limit never stalls the loop. Verified live 2026-11-10. */
export const defaultModelDeps: ModelDeps = {
  open: openChat,
  now: Date.now,
  models: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" },
    { provider: "tokenrouter", model: "x-ai/grok-4.1-fast" },
    { provider: "bluesminds", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "nvidia", model: "z-ai/glm-5.3-flash" },
    { provider: "tokenrouter", model: "deepseek/deepseek-v4.1-flash" },
    { provider: "bluesminds", model: "moonshotai/kimi-k3" },
    { provider: "nvidia", model: "moonshotai/kimi-k2.6" },
    { provider: "tokenrouter", model: "openai/gpt-oss-120b" },
    { provider: "bluesminds", model: "openai/gpt-oss-20b" },
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "openrouter/free" },
  ],
};

const cooldown = new Map<string, number>(); // "provider:model" -> epoch ms until which a 429/overload told us to leave it alone

export const resetCooldowns = (): void => cooldown.clear();

/** Pure. Round-robins the WHOLE roster by `k` (step N starts on a different model than step N-1, across all
 *  providers) and drops models still cooling down. Never returns an empty list. */
export function orderModels(models: ModelRef[], k: number, now: number, cool: ReadonlyMap<string, number> = cooldown): ModelRef[] {
  const r = models.length ? k % models.length : 0;
  const rotated = [...models.slice(r), ...models.slice(0, r)];
  const live = rotated.filter((m) => (cool.get(`${m.provider}:${m.model}`) ?? 0) <= now);
  return live.length ? live : rotated; // everything cooling: try anyway rather than fail without a request
}

export type ModelResult = { ok: true; text: string; model: string; provider: ChatProvider } | { ok: false; error: string };

/**
 * One LLM turn. Streams the model's reasoning as `reasoning` events for `agent`; content is returned (and, with
 * `answerDeltas`, also streamed as `answer` events for the final answer). Falls through the rotated free-model list.
 */
export async function* callModel(
  agent: string,
  messages: ChatMessage[],
  deps: ModelDeps,
  o: { signal?: AbortSignal; round?: number; maxTokens?: number; answerDeltas?: boolean } = {},
): AsyncGenerator<CEvent, ModelResult> {
  let last = "no model available";
  for (const m of orderModels(deps.models, o.round ?? 0, deps.now())) {
    if (o.signal?.aborted) return { ok: false, error: "cancelled" };
    const opened = await deps.open(m.provider, m.model, messages, { signal: o.signal, maxTokens: o.maxTokens ?? 900 });
    if (!opened.ok) {
      last = opened.reason;
      if (/429|503|overload|rate/i.test(opened.reason)) cooldown.set(`${m.provider}:${m.model}`, deps.now() + 60_000);
      continue;
    }
    let text = "";
    let failed: string | null = null;
    try {
      for await (const d of readDeltas(opened.data.body)) {
        if (d.error) { failed = d.error; break; }
        if (d.reasoning) yield { kind: "reasoning", agent, delta: d.reasoning };
        if (d.content) {
          text += d.content;
          if (o.answerDeltas) yield { kind: "answer", delta: d.content };
        }
      }
    } catch (e) {
      failed = e instanceof Error ? e.message : "stream failed";
    }
    if (failed && !text) {
      last = failed;
      cooldown.set(`${m.provider}:${m.model}`, deps.now() + 30_000);
      continue;
    }
    if (!text.trim()) { last = "empty reply"; continue; }
    return { ok: true, text, model: m.model.split("/").pop() ?? m.model, provider: m.provider };
  }
  return { ok: false, error: `every allowlisted model failed: ${last}` };
}
