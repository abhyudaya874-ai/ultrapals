/**
 * Tokens: counted when the provider says how many, estimated from the text when it does not. Pure. Nothing here calls a model.
 *
 * The estimate was calibrated against the exact `prompt_tokens` Groq reports for the same prompts (plain text, JSON, code and the app's own
 * system prompts): characters divided by a number that falls as the share of punctuation rises. Its worst error was 5.7%, where "characters / 4" was off by 12.3%.
 */
export interface Usage {
  prompt: number;
  completion: number;
  /** The most the model can hold at once. */
  window: number;
  /** The provider's id for the model, e.g. `openai/gpt-oss-120b`. */
  model: string;
  provider: string;
  /** True when the provider counted both numbers; false when either was estimated from the text. */
  exact: boolean;
}

const PER_MESSAGE = 4;
const PER_REQUEST = 8;
const MIN_DIVISOR = 2.8;
/** Letters outside ASCII (Chinese, Arabic, emoji ...) take far more tokens per character than English. */
const NON_ASCII_TOKENS = 0.7;

/** Pure. How many tokens a piece of text probably is. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let punct = 0;
  let foreign = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127) { foreign++; continue; }
    const letterOrDigit = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const space = c === 32 || c === 10 || c === 13 || c === 9;
    if (!letterOrDigit && !space) punct++;
  }
  const ascii = text.length - foreign;
  const divisor = Math.max(MIN_DIVISOR, 4.3 - 3.2 * (ascii > 0 ? punct / ascii : 0));
  return Math.ceil(ascii / divisor + foreign * NON_ASCII_TOKENS);
}

/** Pure. The prompt a request sends: its messages plus the small per-message and per-request overhead chat formats add. */
export function messagesTokens(messages: readonly { content: string }[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + PER_MESSAGE, PER_REQUEST);
}

/** What each model on the roster can hold, from its provider's published list (2026-11-10). NVIDIA and Bluesminds publish none, so they use the OpenRouter figure for the same model. */
export const WINDOWS: Readonly<Record<string, number>> = {
  "openai/gpt-oss-120b": 131_072,
  "openai/gpt-oss-20b": 131_072,
  "nvidia/nemotron-3.5-lightning-30b-a3b": 262_144,
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 256_000,
  "nvidia/nemotron-3-ultra-550b-a55b": 262_144,
  "nvidia/nemotron-3-ultra-550b-a55b:free": 1_000_000,
  "nvidia/nemotron-3.5-super-vl-120b-a12b": 1_048_576, // OpenRouter's nvidia/nemotron-3.5-super-vl (2026-11-12)
  "nvidia/nemotron-3.5-bolt-e4b": 65_536, // "64k context", NVIDIA's own model page (research.nvidia.com/labs/nemotron, 2026-11-12)
  "qwen/qwen3.8-27b": 131_072,
  "google/gemma-4-31b-it:free": 262_144,
  "openrouter/free": 200_000,
};
/** For a model nobody has listed: a common size, so a ring is never drawn against zero. */
export const DEFAULT_WINDOW = 128_000;
/** The smallest window on the roster: what a ring is drawn against before any model has answered. */
export const SMALLEST_WINDOW = 65_536;

/** Pure. How many tokens a model can hold. */
export const contextWindow = (model: string): number => WINDOWS[model] ?? DEFAULT_WINDOW;

/** Pure. The usage of one finished call. Counted numbers are used when the provider sent both; otherwise they are estimated from the text (thinking included, as providers count it). */
export function usageFor(o: { messages: readonly { content: string }[]; text: string; thought?: string; counted?: { prompt: number; completion: number }; model: string; provider: string }): Usage {
  const c = o.counted;
  const exact = !!c && c.prompt > 0 && c.completion > 0;
  return {
    prompt: c && c.prompt > 0 ? c.prompt : messagesTokens(o.messages),
    completion: c && c.completion > 0 ? c.completion : estimateTokens(o.text) + estimateTokens(o.thought ?? ""),
    window: contextWindow(o.model),
    model: o.model,
    provider: o.provider,
    exact,
  };
}

/** Pure. "950", "1.2K", "362K", "1M", "1.2M". */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${trim(v / 1000)}K`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${trim(v / 1_000_000)}M`;
}
const trim = (x: number): string => x.toFixed(1).replace(/\.0$/, "");

/** Pure. How full, as a whole percent from 0 to 100. */
export const percentOf = (used: number, window: number): number => (window > 0 ? Math.min(100, Math.max(0, Math.round((used / window) * 100))) : 0);

/** Pure. "0%", "<1%" for a little, otherwise the percent. */
export function percentLabel(used: number, window: number): string {
  if (used <= 0) return "0%";
  const p = percentOf(used, window);
  return p === 0 ? "<1%" : `${p}%`;
}

export type Fill = "calm" | "warn" | "full";
/** Pure. A ring turns amber at 70% and red at 90%: the point where a model starts to forget the start of the conversation. */
export const fillOf = (pct: number): Fill => (pct >= 90 ? "full" : pct >= 70 ? "warn" : "calm");

/** The size of UltraPal's own instructions, before a word has been said (MAIN_SYSTEM; a test keeps this within 10% of the real thing). */
export const MAIN_BASELINE_TOKENS = 1900;
