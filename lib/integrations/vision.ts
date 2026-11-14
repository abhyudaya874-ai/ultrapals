import { z } from "zod";
import { getEnv } from "@/lib/env";
import { isAllowedModel } from "./chat";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";

/** A picture the user attached. `data` is base64 WITHOUT the data-URL prefix; the browser has already shrunk it. */
export interface InImage {
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  data: string;
}

type VisionProvider = "gemini" | "openrouter";
/**
 * Vision models, best first. Every one is on its provider's allowlist (isAllowedModel is checked again before any request). Gemini 3 Flash (Google's
 * free tier) read a real screenshot of this app correctly in 6 s on 2026-11-14 (Flash-Lite took 30 s); the OpenRouter pair were probed 2026-11-10.
 * Gemini 3 Flash has 20 free requests a day: once they are gone it answers 429 in about a second and the next model reads the picture.
 */
export const VISION_MODELS: readonly { provider: VisionProvider; model: string }[] = [
  { provider: "gemini", model: "gemini-3-flash-preview" },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
];
const URL_OF: Record<VisionProvider, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", // aistudio.google.com/docs/openai#image-understanding
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

const Reply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1) });

/** Pure. The request body for one vision call: the instruction, then each image as a data URL. Gemini is told to think briefly (it thinks either way). */
export function visionBody(model: string, instruction: string, images: readonly InImage[], provider: VisionProvider = "openrouter") {
  return {
    model,
    max_tokens: 900, // the reasoning models think before they answer; a small cap returns an empty reply
    ...(provider === "gemini" ? { reasoning_effort: "low" } : {}),
    messages: [{ role: "user", content: [{ type: "text", text: instruction }, ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] }],
  };
}

/** Pure. The text of the first choice, or null when it is empty. */
export function visionText(json: unknown): string | null {
  const r = Reply.safeParse(json);
  const t = r.success ? r.data.choices[0].message.content?.trim() : undefined;
  return t ? t : null;
}

/** One model's reading of the pictures, inside its own provider's guard. */
async function ask(provider: VisionProvider, model: string, instruction: string, images: readonly InImage[], signal?: AbortSignal): Promise<AdapterResult<{ text: string; model: string }>> {
  return guard(provider, async () => {
    const env = getEnv();
    const key = (provider === "gemini" ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY) ?? "";
    const res = await fetch(URL_OF[provider], {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(visionBody(model, instruction, images, provider)),
      signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]),
    });
    if (!res.ok) return degrade(`${model}: http ${res.status}`);
    const text = visionText(await res.json().catch(() => null));
    return text ? { ok: true, data: { text, model: model.split("/").pop()?.replace(/:free$/, "") ?? model } } : degrade(`${model}: empty reply`);
  });
}

/**
 * Asks a vision model what is in the user's pictures and returns plain text for the planner (which cannot see images).
 * Tries each vision model in order, skipping a provider that is off; one failing never fails the run: the caller shows "could not read the image".
 */
export async function describeImages(images: readonly InImage[], instruction: string, opts: { signal?: AbortSignal } = {}): Promise<AdapterResult<{ text: string; model: string }>> {
  const usable = VISION_MODELS.filter((m) => isOn(m.provider) && isAllowedModel(m.provider, m.model));
  if (usable.length === 0) return degrade("no vision provider on: images cannot be read");
  if (images.length === 0) return degrade("no images");
  let last = "no vision model answered";
  for (const m of usable) {
    const r = await ask(m.provider, m.model, instruction, images, opts.signal);
    if (opts.signal?.aborted) return degrade("cancelled");
    if (r.ok) return r;
    last = r.reason;
  }
  return degrade(last);
}
