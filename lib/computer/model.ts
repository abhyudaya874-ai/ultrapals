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

/** Fastest first. Groq's free TPM limit is PER MODEL, so alternating the two gpt-oss sizes roughly doubles an agent's budget. */
export const defaultModelDeps: ModelDeps = {
  open: openChat,
  now: Date.now,
  models: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "openrouter/free" },
  ],
};

const cooldown = new Map<string, number>(); // model -> epoch ms until which a 429/overload told us to leave it alone

export const resetCooldowns = (): void => cooldown.clear();

/** Pure. Rotates the leading Groq pair by `k` (so step N starts on a different model than step N-1) and drops models still cooling down. */
export function orderModels(models: ModelRef[], k: number, now: number, cool: ReadonlyMap<string, number> = cooldown): ModelRef[] {
  const g = models.findIndex((m) => m.provider !== "groq");
  const head = models.slice(0, g < 0 ? models.length : g);
  const r = head.length ? k % head.length : 0;
  const rotated = [...head.slice(r), ...head.slice(0, r), ...models.slice(head.length)];
  const live = rotated.filter((m) => (cool.get(m.model) ?? 0) <= now);
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
      if (/429|503|overload|rate/i.test(opened.reason)) cooldown.set(m.model, deps.now() + 60_000);
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
      cooldown.set(m.model, deps.now() + 30_000);
      continue;
    }
    if (!text.trim()) { last = "empty reply"; continue; }
    return { ok: true, text, model: m.model.split("/").pop() ?? m.model, provider: m.provider };
  }
  return { ok: false, error: `every free model failed: ${last}` };
}
