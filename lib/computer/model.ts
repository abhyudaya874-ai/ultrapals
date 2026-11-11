import { openChat, readDeltas, type ChatMessage, type ChatProvider } from "@/lib/integrations/chat";
import { usageFor, type Usage } from "@/lib/usage/tokens";
import type { CEvent } from "./events";

export interface ModelRef {
  provider: ChatProvider;
  model: string;
}
export interface ModelDeps {
  open: typeof openChat;
  models: ModelRef[];
  now: () => number;
  /** callModelHedged races this many models at once (1..3, default 1). Costs extra requests, saves the 40s stall. */
  hedge?: number;
  /** false = the roster order is used as given on every call (a chosen model stays first); default true rotates by round to spread rate limits. */
  rotate?: boolean;
}

/** Fastest first, spread across all five providers so one rate limit never stalls the loop. Verified live 2026-11-10. */
export const defaultModelDeps: ModelDeps = {
  open: openChat,
  now: Date.now,
  hedge: 2,
  models: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "bluesminds", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "bluesminds", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
    { provider: "bluesminds", model: "nvidia/nemotron-3-ultra-550b-a55b" },
    { provider: "bluesminds", model: "meta/muse-glimmer-30b" },
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

export const MODEL_TIMEOUT_MS = 40_000;

/** A failed call carries `rejected` (the last reply `accept` refused) when models did answer but none with something usable, so a caller can tell that from "no model answered". */
export type ModelResult = { ok: true; text: string; model: string; provider: ChatProvider; usage: Usage } | { ok: false; error: string; rejected?: string };

/** The event for a finished call. */
export const usageEvent = (agent: string, u: Usage): CEvent => ({ kind: "usage", agent, prompt: u.prompt, completion: u.completion, window: u.window, model: u.model, provider: u.provider, exact: u.exact });

/**
 * One LLM turn. Streams the model's reasoning as `reasoning` events for `agent`; content is returned (and, with
 * `answerDeltas`, also streamed as `answer` events for the final answer). Falls through the rotated free-model list.
 */
export async function* callModel(
  agent: string,
  messages: ChatMessage[],
  deps: ModelDeps,
  o: { signal?: AbortSignal; round?: number; maxTokens?: number; answerDeltas?: boolean; modelTimeoutMs?: number; accept?: (text: string) => boolean; streamAnswer?: (accum: string) => string } = {},
): AsyncGenerator<CEvent, ModelResult> {
  let last = "no model available";
  let rejected: string | undefined;
  for (const m of orderModels(deps.models, deps.rotate === false ? 0 : (o.round ?? 0), deps.now())) {
    if (o.signal?.aborted) return { ok: false, error: "cancelled" };
    const deadline = AbortSignal.timeout(o.modelTimeoutMs ?? MODEL_TIMEOUT_MS); // a stalled model costs this long, not the adapter's 60s
    const opened = await deps.open(m.provider, m.model, messages, { signal: o.signal ? AbortSignal.any([o.signal, deadline]) : deadline, maxTokens: o.maxTokens ?? 900 });
    if (!opened.ok) {
      last = opened.reason;
      if (o.signal?.aborted) return { ok: false, error: "cancelled" }; // our own abort is not the provider's fault
      if (/http (402|403|404|410)\b/.test(opened.reason)) cooldown.set(`${m.provider}:${m.model}`, deps.now() + 600_000);
      else if (/429|503|overload|rate|timeout/i.test(opened.reason)) cooldown.set(`${m.provider}:${m.model}`, deps.now() + 60_000);
      continue;
    }
    let text = "";
    let thought = "";
    let counted: { prompt: number; completion: number } | undefined;
    let shown = "";
    let failed: string | null = null;
    try {
      for await (const d of readDeltas(opened.data.body)) {
        if (d.error) { failed = d.error; break; }
        if (d.usage) counted = d.usage;
        if (d.reasoning) { thought += d.reasoning; yield { kind: "reasoning", agent, delta: d.reasoning }; }
        if (d.content) {
          text += d.content;
          if (o.answerDeltas) yield { kind: "answer", delta: d.content };
          else if (o.streamAnswer) {
            // the answer is inside a JSON object: show its text as it is written, only ever by appending
            const full = o.streamAnswer(text);
            if (full.length > shown.length && full.startsWith(shown)) {
              yield { kind: "answer", delta: full.slice(shown.length) };
              shown = full;
            }
          }
        }
      }
    } catch (e) {
      failed = e instanceof Error ? e.message : "stream failed";
    }
    if (failed && !text) {
      if (o.signal?.aborted) return { ok: false, error: "cancelled" };
      last = failed;
      cooldown.set(`${m.provider}:${m.model}`, deps.now() + 30_000);
      continue;
    }
    if (!text.trim()) { last = "empty reply"; continue; }
    if (o.accept && !o.accept(text)) { last = `${m.model.split("/").pop()} replied but the reply was unusable`; rejected = text; continue; } // try the next model, not the next round
    // The provider's own count when it sent one, an estimate from the text when it did not (usageFor says which).
    const usage = usageFor({ messages, text, thought, counted, model: m.model, provider: m.provider });
    yield usageEvent(agent, usage);
    return { ok: true, text, model: m.model.split("/").pop() ?? m.model, provider: m.provider, usage };
  }
  return rejected === undefined ? { ok: false, error: `every allowlisted model failed: ${last}` } : { ok: false, error: `every allowlisted model failed: ${last}`, rejected };
}

/**
 * Races `deps.hedge` models on the same prompt (each starts on a different round of the rotation) and returns the first good
 * reply; the losers are aborted. A stalled model then costs nothing instead of MODEL_TIMEOUT_MS. With hedge 1 it is callModel.
 * Reasoning events are dropped when racing (they cannot be attributed to the winner before it wins).
 */
export async function* callModelHedged(
  agent: string,
  messages: ChatMessage[],
  deps: ModelDeps,
  o: { signal?: AbortSignal; round?: number; maxTokens?: number; modelTimeoutMs?: number; accept?: (text: string) => boolean; streamAnswer?: (accum: string) => string } = {},
): AsyncGenerator<CEvent, ModelResult> {
  const n = Math.max(1, Math.min(Math.floor(deps.hedge ?? 1), 3));
  if (n === 1) return yield* callModel(agent, messages, deps, o);
  const ctrls = Array.from({ length: n }, () => new AbortController());
  // Reasoning of the racers cannot all be shown; the first one to start thinking is the one the UI follows.
  const queue: CEvent[] = [];
  let leader = -1;
  let wake: (() => void) | null = null;
  const ping = () => { const w = wake; wake = null; w?.(); };
  const runs = ctrls.map(async (c, i): Promise<ModelResult> => {
    const signal = o.signal ? AbortSignal.any([o.signal, c.signal]) : c.signal;
    // racers must start on different models: with a fixed order, racer i starts i places down the list
    const g = callModel(agent, messages, deps.rotate === false ? { ...deps, models: [...deps.models.slice(i), ...deps.models.slice(0, i)] } : deps, { ...o, signal, round: (o.round ?? 0) + i });
    for (;;) {
      const x = await g.next();
      if (x.done) return x.value;
      if (x.value.kind === "reasoning" && (leader === -1 || leader === i)) {
        leader = i;
        queue.push(x.value);
        ping();
      }
    }
  });
  let finished = false;
  const result = new Promise<ModelResult>((resolve) => {
    let pending = n;
    let err = "no model available";
    let rejected: string | undefined;
    runs.forEach((p, i) =>
      p.then(
        (r) => {
          if (r.ok) {
            ctrls.forEach((c, j) => { if (j !== i) c.abort(); });
            resolve(r);
          } else {
            if (r.error !== "cancelled" || err === "no model available") err = r.error;
            if (r.rejected !== undefined) rejected = r.rejected;
            if (--pending === 0) resolve(rejected === undefined ? { ok: false, error: err } : { ok: false, error: err, rejected });
          }
        },
        (e) => { if (--pending === 0) resolve({ ok: false, error: e instanceof Error ? e.message : "hedge failed" }); },
      ),
    );
  });
  void result.then(() => { finished = true; ping(); });
  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((r) => { wake = r; if (queue.length || finished) ping(); });
  }
  const won = await result;
  // The racers' own events were dropped above, so the winner's usage is told here, once.
  if (won.ok) yield usageEvent(agent, won.usage);
  return won;
}
