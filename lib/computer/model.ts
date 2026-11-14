import { openChat, readDeltas, type ChatMessage, type ChatProvider } from "@/lib/integrations/chat";
import { contextWindow, estimateTokens, messagesTokens, usageFor, type Usage } from "@/lib/usage/tokens";
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
  /** true = a call also tells `usage_live` while it runs (the prompt at once, the reply as it grows), so the context ring moves in real time. */
  live?: boolean;
  /** Only the first `spread` models take turns to lead; the rest stay behind them as the fallback, in order. Default: all of them. */
  spread?: number;
  /** How a call waits for a rate limit to clear. Real time unless a test says otherwise. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Measured live 2026-11-12. The three Groq models answer in 1 to 3 s, but each has only 8,000 tokens a minute and 200,000 a day for the whole account
 * (Groq's published free limits, which its headers confirmed), so a Battle with three teams at once runs into them within a minute. NVIDIA's key
 * accepted eight requests at once without a refusal, and three of its models answer usable JSON in 3.5 to 9 s (Bolt, Super VL, Ultra). Bluesminds
 * refused one request of two sent together. OpenRouter's free models allow 50 requests a day on an account that has bought no credits.
 * Google's free tier (measured 2026-11-14): 3.5 Flash-Lite answers in 0.8 to 2 s with a limit of 15 requests a minute per model for the project (a
 * burst of 22 got four 429s saying so); 3.1 Flash-Lite stalled for 15 s, 70 s and a 503 on three tries out of nine; Gemini 3 Flash is the strongest
 * but the free tier gives the project only 20 requests a day for it (its 429: quotaValue "20"), so it never leads a rotation and is kept for Ultra's
 * race, as a late fallback and for pictures. When the day's 20 are gone the router benches it (cooldownFor, "daily") and Flash-Lite stands in.
 * So the leaders alternate between Groq's three separate limits, Google's Flash-Lite and NVIDIA's two strongest (`spread`), and the rest are the
 * fallback, in the order they are worth waiting for. The Nemotron Lightning copies think for 17 to 25 s before answering, so they come late.
 */
export const defaultModelDeps: ModelDeps = {
  open: openChat,
  now: Date.now,
  hedge: 2,
  live: true,
  spread: 6,
  models: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" },
    { provider: "groq", model: "qwen/qwen3.8-27b" },
    { provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "nvidia", model: "nvidia/nemotron-3.5-bolt-e4b" },
    { provider: "gemini", model: "gemini-3-flash-preview" },
    { provider: "bluesminds", model: "nvidia/nemotron-3-ultra-550b-a55b" },
    { provider: "bluesminds", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
    { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "bluesminds", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "openrouter/free" },
  ],
};
const cooldown = new Map<string, number>(); // "provider:model" -> epoch ms until which a 429/overload told us to leave it alone

export const resetCooldowns = (): void => cooldown.clear();

/** Pure. Round-robins the first `spread` models (default: the whole roster) by `k`, so step N starts on a different model than step N-1; the rest follow in
 *  order. Drops models still cooling down. Never returns an empty list. */
export function orderModels(models: ModelRef[], k: number, now: number, cool: ReadonlyMap<string, number> = cooldown, spread: number = models.length): ModelRef[] {
  const s = Math.max(1, Math.min(spread, models.length));
  const r = models.length ? k % s : 0;
  const rotated = [...models.slice(r, s), ...models.slice(0, r), ...models.slice(s)];
  const live = rotated.filter((m) => (cool.get(`${m.provider}:${m.model}`) ?? 0) <= now);
  return live.length ? live : rotated; // everything cooling: try anyway rather than fail without a request
}

/**
 * Extra tokens a model needs to think before it answers. Measured 2026-11-12 on a JSON reply of about 300 tokens: Nemotron Lightning thinks for 1,300 to
 * 1,900 tokens first, so a budget of 900 ended mid-thought with an empty reply every time (17 s spent, then on to the next model); Nano Omni cut its JSON
 * off; Ultra and the GPT-OSS and Qwen models fit. This is only a ceiling: a model that thinks briefly stops early and costs no more.
 */
const THINKING_HEADROOM: Record<string, number> = {
  "nvidia/nemotron-3.5-lightning-30b-a3b": 3500,
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 2500,
  "nvidia/nemotron-3-ultra-550b-a55b": 1500,
  "nvidia/nemotron-3.5-super-vl": 2500,
  "nvidia/nemotron-3.5-super-vl-120b-a12b": 1500,
  "openrouter/free": 1500,
  // Gemini thinks at "low" before it writes, and that thinking counts against max_tokens: 180 to 300 tokens on a planner reply (2026-11-14);
  // a 120-token budget returned only thought summary
  "gemini-3-flash-preview": 1000,
  "gemini-3.5-flash-lite": 800,
  "gemini-3.1-flash-lite": 800,
};
/** Pure. The token ceiling to ask this model for: what the call wants for its reply, plus the room the model uses to think. */
export const tokenBudget = (model: string, asked: number): number => asked + (THINKING_HEADROOM[model.replace(/:free$/i, "")] ?? 0);

/** How long a rate limit that says "retry Ns" is worth waiting for inside a call, rather than failing it. */
export const RETRY_WAIT_MAX_MS = 10_000;

/**
 * Pure. How long to leave a model alone after a failed request, from the reason the adapter gave. A model that is gone, unfunded or behind a refused
 * key (401/402/403/404/410): 10 minutes. A limit for the day ("daily"): as long as it says (Groq's daily allowance is a rolling window, so "retry 537s" really is nine minutes),
 * or an hour when it does not say. A per-minute rate limit that says when it clears ("retry 7s"): that long and half a second, so a model whose minute
 * has refilled is used again at once instead of being benched for a whole minute. Anything else that looks like load: a minute. Otherwise none.
 */
export function cooldownFor(reason: string, stalled: boolean): number {
  // 401 too: a key the provider refuses fails every call at once. Seen live 2026-11-12 after a key with a stray character was pasted in.
  if (/http (401|402|403|404|410)\b/.test(reason)) return 600_000;
  const retry = /retry (\d+)s/.exec(reason);
  if (/\bdaily\b/.test(reason)) return retry ? Math.min(3_600_000, Number(retry[1]) * 1000 + 500) : 3_600_000;
  if (retry) return Math.min(60_000, Number(retry[1]) * 1000 + 500);
  return stalled || /429|503|overload|rate|timeout/i.test(reason) ? 60_000 : 0;
}

/**
 * Pure. The roster with one model moved to the back: the model that just answered `provider` + `bare` (callModel reports the bare name). The lead agent
 * uses it when a reply cannot be read, so its next try starts on another model, even a team's pinned one, instead of asking the same model again.
 */
export function demote(models: readonly ModelRef[], provider: string, bare: string): ModelRef[] {
  const hit = (m: ModelRef) => m.provider === provider && (m.model.split("/").pop() ?? m.model) === bare;
  return [...models.filter((m) => !hit(m)), ...models.filter(hit)];
}

/** Pure. True when a model is benched for a long while (gone, unfunded, or out of requests for the day): nothing should be pinned to it. */
export const benchedLong = (m: ModelRef, now: number, cool: ReadonlyMap<string, number> = cooldown): boolean => (cool.get(`${m.provider}:${m.model}`) ?? 0) - now > 300_000;

/** Pure. The shortest wait, in ms, until a model that is cooling down is free again, if that is short enough to be worth waiting for. */
export function shortestWait(models: readonly ModelRef[], now: number, cool: ReadonlyMap<string, number> = cooldown): number | null {
  const waits = models.map((m) => (cool.get(`${m.provider}:${m.model}`) ?? 0) - now).filter((w) => w > 0);
  const least = waits.length ? Math.min(...waits) : null;
  return least !== null && least <= RETRY_WAIT_MAX_MS ? least : null;
}
const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

export const MODEL_TIMEOUT_MS = 40_000;
/** A model that has sent nothing at all (no thinking, no words) for this long is stalled. The next one is tried now, instead of waiting out MODEL_TIMEOUT_MS on a connection that may never speak. */
export const FIRST_WORD_MS = 15_000;

/** A failed call carries `rejected` (the last reply `accept` refused) when models did answer but none with something usable, so a caller can tell that from "no model answered". */
export type ModelResult = { ok: true; text: string; model: string; provider: ChatProvider; usage: Usage } | { ok: false; error: string; rejected?: string };

/** The event for a finished call. */
export const usageEvent = (agent: string, u: Usage): CEvent => ({ kind: "usage", agent, prompt: u.prompt, completion: u.completion, window: u.window, model: u.model, provider: u.provider, exact: u.exact });

/** How often a running call reports its growing reply. Often enough to look continuous, rarely enough that estimating the text stays cheap. */
export const LIVE_MS = 150;
/** The event for a call in progress. `completion` is an estimate from the text so far. */
export const liveEvent = (agent: string, m: ModelRef, prompt: number, completion: number): CEvent => ({ kind: "usage_live", agent, prompt, completion, window: contextWindow(m.model), model: m.model, provider: m.provider });

/**
 * One LLM turn. Streams the model's reasoning as `reasoning` events for `agent`; content is returned (and, with
 * `answerDeltas`, also streamed as `answer` events for the final answer). Falls through the rotated free-model list.
 */
export async function* callModel(
  agent: string,
  messages: ChatMessage[],
  deps: ModelDeps,
  o: { signal?: AbortSignal; round?: number; maxTokens?: number; answerDeltas?: boolean; modelTimeoutMs?: number; firstWordMs?: number; accept?: (text: string) => boolean; streamAnswer?: (accum: string) => string } = {},
): AsyncGenerator<CEvent, ModelResult> {
  let last = "no model available";
  let rejected: string | undefined;
  // Two passes at most: if every model failed but one of them is only waiting out a short rate limit, wait for it once and go round again.
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      const wait = shortestWait(deps.models, deps.now());
      if (wait === null) break;
      await (deps.sleep ?? realSleep)(wait + 100, o.signal);
      if (o.signal?.aborted) return { ok: false, error: "cancelled" };
    }
    for (const m of orderModels(deps.models, deps.rotate === false ? 0 : (o.round ?? 0), deps.now(), cooldown, deps.spread)) {
      if (o.signal?.aborted) return { ok: false, error: "cancelled" };
      // The prompt is known before the model is even asked, so the ring takes it now. Waiting for a slow model then shows as "waiting", not as nothing at all.
      const promptNow = deps.live ? messagesTokens(messages) : 0;
      if (deps.live) yield liveEvent(agent, m, promptNow, 0);
      const deadline = AbortSignal.timeout(o.modelTimeoutMs ?? MODEL_TIMEOUT_MS); // a stalled model costs this long, not the adapter's 60s
      const quiet = new AbortController();
      let stalled = false;
      const quietMs = Math.min(o.firstWordMs ?? FIRST_WORD_MS, o.modelTimeoutMs ?? MODEL_TIMEOUT_MS);
      const quietTimer = setTimeout(() => { stalled = true; quiet.abort(); }, quietMs);
      try {
        const opened = await deps.open(m.provider, m.model, messages, { signal: AbortSignal.any([deadline, quiet.signal, ...(o.signal ? [o.signal] : [])]), maxTokens: tokenBudget(m.model, o.maxTokens ?? 900) });
        if (!opened.ok) {
          last = stalled ? `${m.model.split("/").pop()} sent nothing for ${Math.round(quietMs / 1000)}s` : opened.reason;
          if (o.signal?.aborted) return { ok: false, error: "cancelled" }; // our own abort is not the provider's fault
          const bench = cooldownFor(opened.reason, stalled);
          if (bench > 0) cooldown.set(`${m.provider}:${m.model}`, deps.now() + bench);
          continue;
        }
        let text = "";
        let thought = "";
        let counted: { prompt: number; completion: number } | undefined;
        let shown = "";
        let failed: string | null = null;
        let lastLive = deps.now();
        try {
          for await (const d of readDeltas(opened.data.body)) {
            if (d.error) { failed = d.error; break; }
            if (d.usage) counted = d.usage;
            if (d.reasoning || d.content) clearTimeout(quietTimer); // it is talking: only the overall deadline applies from here
            if (deps.live && (d.reasoning || d.content) && deps.now() - lastLive >= LIVE_MS) {
              lastLive = deps.now();
              yield liveEvent(agent, m, promptNow, estimateTokens(text + (d.content ?? "")) + estimateTokens(thought + (d.reasoning ?? "")));
            }
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
          last = stalled ? `${m.model.split("/").pop()} sent nothing for ${Math.round(quietMs / 1000)}s` : failed;
          cooldown.set(`${m.provider}:${m.model}`, deps.now() + (stalled ? 60_000 : 30_000));
          continue;
        }
        // A reply that broke off part way (the deadline, a dropped connection, an error from the provider) is not a reply: a planner or a judge would
        // read half a JSON object as a bad answer. Seen live 2026-11-12: a busy Nemotron Ultra was cut at 40 s mid-JSON and the team lost a turn to it.
        // Unless the person has already seen part of it, the next model gets the call and the slow one rests.
        if (failed && !(o.answerDeltas || shown)) {
          if (o.signal?.aborted) return { ok: false, error: "cancelled" };
          last = `${m.model.split("/").pop()} broke off part way: ${failed}`;
          cooldown.set(`${m.provider}:${m.model}`, deps.now() + 30_000);
          continue;
        }
        if (!text.trim()) { last = "empty reply"; cooldown.set(`${m.provider}:${m.model}`, deps.now() + 30_000); continue; } // it spent its budget thinking, or is overloaded: not this one again for a moment
        if (o.accept && !o.accept(text)) { last = `${m.model.split("/").pop()} replied but the reply was unusable`; rejected = text; continue; } // try the next model, not the next round
        // The provider's own count when it sent one, an estimate from the text when it did not (usageFor says which).
        const usage = usageFor({ messages, text, thought, counted, model: m.model, provider: m.provider });
        yield usageEvent(agent, usage);
        return { ok: true, text, model: m.model.split("/").pop() ?? m.model, provider: m.provider, usage };
      } finally {
        clearTimeout(quietTimer);
      }
    }
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
  // Once, for the whole race: the prompt is known now, and the racers' own opening reports are dropped below (three of them would each claim the ring for a model that may lose).
  const lead = deps.live ? orderModels(deps.models, deps.rotate === false ? 0 : (o.round ?? 0), deps.now(), cooldown, deps.spread)[0] : undefined;
  if (lead) yield liveEvent(agent, lead, messagesTokens(messages), 0);
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
      // The racer that is first to stream anything is the one the screen follows, for its thinking and for its growing token count. A racer's
      // opening report (no reply yet) is dropped: three racers would each claim the ring for a model that may lose.
      const follow = x.value.kind === "reasoning" || (x.value.kind === "usage_live" && x.value.completion > 0);
      if (follow && (leader === -1 || leader === i)) {
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
