import type { ChatProvider } from "@/lib/integrations/chat";
import type { ModelDeps, ModelRef } from "./model";

/**
 * What the model pill in the input box means. It is honest about what it does: it changes WHICH of the allowlisted free models go first,
 * how many race on each call and how many planning rounds UltraPal gets. It never reaches a model that is not already on the roster.
 */
export const LEVELS = ["light", "standard", "high", "ultra"] as const;
export type Level = (typeof LEVELS)[number];

export interface ModelChoice {
  level: Level;
  /** A model picked by hand: it goes first on every call, the rest of the roster stays behind it as the fallback. */
  pin?: ModelRef;
}
export const DEFAULT_CHOICE: ModelChoice = { level: "standard" };

interface LevelInfo {
  label: string;
  /** The model that leads at this level (shown in the popover). */
  lead: string;
  blurb: string;
  /** Model ids that go to the front of the roster, in order. */
  first: string[];
  hedge: number;
  rounds: number;
}
export const LEVEL_INFO: Record<Level, LevelInfo> = {
  // Light races Groq's fastest model against Google's: two providers, so one provider's bad minute does not slow both racers
  light: { label: "Light", lead: "GPT-OSS 20B", blurb: "for quick answers. Lowest usage.", first: ["openai/gpt-oss-20b", "gemini-3.5-flash-lite", "qwen/qwen3.8-27b"], hedge: 2, rounds: 4 },
  standard: { label: "Standard", lead: "Free model rotation", blurb: "for balanced speed and depth. Spreads the load across every provider.", first: [], hedge: 2, rounds: 6 },
  high: { label: "High", lead: "GPT-OSS 120B", blurb: "for deeper reasoning on harder tasks. Higher usage.", first: ["openai/gpt-oss-120b", "nvidia/nemotron-3-ultra-550b-a55b", "gemini-3-flash-preview"], hedge: 2, rounds: 6 },
  // Ultra's three racers are three model families: NVIDIA, OpenAI's open weights and Google
  ultra: { label: "Ultra", lead: "Nemotron 3 Ultra 550B", blurb: "for maximum effort and thoroughness. Races three models, plans up to 8 rounds. Highest usage.", first: ["nvidia/nemotron-3-ultra-550b-a55b", "openai/gpt-oss-120b", "gemini-3-flash-preview"], hedge: 3, rounds: 8 },
};

/** The models a person can pin in "Custom". Mirrors the server roster; the server refuses anything not on it. */
export const PICKABLE: (ModelRef & { label: string; note: string })[] = [
  { provider: "groq", model: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "Groq · strongest general model here" },
  { provider: "groq", model: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "Groq · fastest" },
  { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B", note: "NVIDIA · largest" },
  { provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b", label: "Nemotron 3.5 Super VL 120B", note: "NVIDIA · balanced" },
  { provider: "bluesminds", model: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B", note: "Bluesminds · quick" },
  { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B", note: "NVIDIA · quick" },
  { provider: "bluesminds", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", label: "Nemotron 3 Nano Omni 30B", note: "Bluesminds · reasoning" },
  { provider: "groq", model: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", note: "Groq · fast, no thinking" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", note: "OpenRouter · free" },
  { provider: "gemini", model: "gemini-3-flash-preview", label: "Gemini 3 Flash", note: "Google · free tier, 20 requests a day" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Google · free tier" },
  { provider: "gemini", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", note: "Google · free tier" },
];

/** Whose mark goes beside a model's name. Google has two: Gemini's star and Gemma's own. */
export type Maker = "openai" | "gemini" | "gemma" | "nvidia" | "qwen";
/** Pure. Who made a model, read from its id (any provider's copy of it), or null for one nobody here has a mark for. */
export function makerOf(model: string): Maker | null {
  const m = model.toLowerCase();
  if (m.includes("gpt-oss")) return "openai";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("gemma")) return "gemma";
  if (m.includes("nemotron") || m.startsWith("nvidia/")) return "nvidia";
  if (m.includes("qwen")) return "qwen";
  return null;
}
/**
 * Pure. The models the Custom list shows: each name once. Two providers can serve the same model (Nemotron Lightning on NVIDIA and on Bluesminds); the
 * person picks a model, not a host, so the list shows one and prefers the host that is not the credit-funded gateway.
 */
export function pickList<T extends ModelRef & { label: string }>(list: readonly T[] = PICKABLE as unknown as readonly T[]): T[] {
  const out: T[] = [];
  for (const m of list) {
    const i = out.findIndex((x) => x.label === m.label);
    if (i < 0) out.push(m);
    else if (out[i].provider === "bluesminds" && m.provider !== "bluesminds") out[i] = m;
  }
  return out;
}
/** Pure. True when the pinned model is this list entry, or the same model on another host. */
export const isPicked = (pin: ModelRef | undefined, m: ModelRef & { label: string }): boolean => !!pin && PICKABLE.some((p) => p.label === m.label && same(p, pin));

const same = (a: ModelRef, b: ModelRef): boolean => a.provider === b.provider && a.model === b.model;
export const isPinnable = (m: ModelRef, roster: readonly ModelRef[]): boolean => roster.some((r) => same(r, m));

/** Pure. Moves the wanted model ids to the front (each id's first roster entry, in the order asked); everything else keeps its order behind them. */
export function preferFirst(models: readonly ModelRef[], ids: readonly string[]): ModelRef[] {
  const head: ModelRef[] = [];
  for (const id of ids) {
    const m = models.find((x) => x.model === id && !head.includes(x));
    if (m) head.push(m);
  }
  return [...head, ...models.filter((m) => !head.includes(m))];
}

/**
 * Pure. The roster the whole run uses. The roster keeps every model (SituationPal's blind check needs a second model family), only the
 * order changes. A pinned model that is not on the base roster is ignored, so a forged request cannot reach a model the server did not allow.
 */
export function modelDepsFor(base: ModelDeps, choice: ModelChoice): ModelDeps {
  const info = LEVEL_INFO[choice.level];
  if (choice.pin && isPinnable(choice.pin, base.models)) {
    const pin = base.models.find((m) => same(m, choice.pin!))!;
    return { ...base, models: [pin, ...base.models.filter((m) => m !== pin)], hedge: 1, rotate: false };
  }
  if (choice.level === "standard") return { ...base, hedge: info.hedge };
  return { ...base, models: preferFirst(base.models, info.first), hedge: info.hedge, rotate: false };
}

/**
 * Models that answered a browsing step with a valid action fastest when every roster model was timed on the same page (2026-11-10: GPT-OSS 120B
 * 2.5 s, 20B 0.8 s, Nemotron Ultra 13 s; Muse took 29 s and several Nemotrons spent their whole budget thinking). A browsing step is waited for, so
 * these go first, unless the person pinned a model or a level fixed the order on purpose.
 */
export const BROWSING_FIRST = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "nvidia/nemotron-3-ultra-550b-a55b"] as const;

/** Pure. The roster for a browsing step: fast, reliable models first. A run whose order was fixed on purpose (a pinned model, High, Ultra) keeps it. */
export function browsingDeps(base: ModelDeps): ModelDeps {
  return base.rotate === false ? base : { ...base, models: preferFirst(base.models, BROWSING_FIRST), rotate: false };
}

/** Pure. How many planning rounds UltraPal gets. A pinned model uses the Standard budget. */
export const roundsFor = (choice: ModelChoice): number => (choice.pin ? LEVEL_INFO.standard.rounds : LEVEL_INFO[choice.level].rounds);

/** Pure. The pill text and the popover headline for a choice. */
export function describeChoice(choice: ModelChoice): { pill: string; title: string; blurb: string; maker: Maker | null } {
  if (choice.pin) {
    const p = PICKABLE.find((m) => same(m, choice.pin!));
    return { pill: p?.label ?? choice.pin.model, title: p?.label ?? choice.pin.model, blurb: "chosen by you. Used first on every call; the other models stay as fallbacks.", maker: makerOf(choice.pin.model) };
  }
  const i = LEVEL_INFO[choice.level];
  // Standard has no lead model, it rotates through all of them: no mark
  return { pill: i.label, title: i.lead, blurb: i.blurb, maker: choice.level === "standard" ? null : makerOf(i.first[0] ?? "") };
}

export const PROVIDERS: readonly ChatProvider[] = ["groq", "openrouter", "nvidia", "tokenrouter", "bluesminds", "gemini"];
/** Pure. Reads a stored or posted choice without trusting it. Anything malformed is Standard. */
export function parseChoice(v: unknown): ModelChoice {
  if (!v || typeof v !== "object") return DEFAULT_CHOICE;
  const o = v as { level?: unknown; pin?: unknown };
  const level = (LEVELS as readonly unknown[]).includes(o.level) ? (o.level as Level) : "standard";
  const p = o.pin as { provider?: unknown; model?: unknown } | undefined;
  const pin = p && typeof p.model === "string" && p.model.length < 100 && (PROVIDERS as readonly unknown[]).includes(p.provider) ? { provider: p.provider as ChatProvider, model: p.model } : undefined;
  return pin ? { level, pin } : { level };
}
