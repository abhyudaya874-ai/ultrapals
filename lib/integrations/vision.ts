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

/** Vision models, best first. Both are on the OpenRouter allowlist (isAllowedModel is checked again before any request). Probed live 2026-11-10: the first reads images. */
export const VISION_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"] as const;

const Reply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1) });

/** Pure. The request body for one vision call: the instruction, then each image as a data URL. */
export function visionBody(model: string, instruction: string, images: readonly InImage[]) {
  return {
    model,
    max_tokens: 900, // the reasoning models think before they answer; a small cap returns an empty reply
    messages: [{ role: "user", content: [{ type: "text", text: instruction }, ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] }],
  };
}

/** Pure. The text of the first choice, or null when it is empty. */
export function visionText(json: unknown): string | null {
  const r = Reply.safeParse(json);
  const t = r.success ? r.data.choices[0].message.content?.trim() : undefined;
  return t ? t : null;
}

/**
 * Asks a vision model what is in the user's pictures and returns plain text for the planner (which cannot see images).
 * Tries each vision model in order; one failing never fails the run: the caller shows "could not read the image".
 */
export async function describeImages(images: readonly InImage[], instruction: string, opts: { signal?: AbortSignal } = {}): Promise<AdapterResult<{ text: string; model: string }>> {
  if (!isOn("openrouter")) return degrade("openrouter off: images cannot be read");
  if (images.length === 0) return degrade("no images");
  return guard("openrouter", async () => {
    const key = getEnv().OPENROUTER_API_KEY ?? "";
    let last = "no vision model answered";
    for (const model of VISION_MODELS) {
      if (!isAllowedModel("openrouter", model)) continue;
      const signals = [AbortSignal.timeout(45_000), ...(opts.signal ? [opts.signal] : [])];
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(visionBody(model, instruction, images)),
        signal: AbortSignal.any(signals),
      }).catch((e: unknown) => e);
      if (opts.signal?.aborted) return degrade("cancelled");
      if (!(res instanceof Response)) { last = `${model}: ${res instanceof Error ? res.message : "network error"}`; continue; }
      if (!res.ok) { last = `${model}: http ${res.status}`; continue; }
      const text = visionText(await res.json().catch(() => null));
      if (text) return { ok: true, data: { text, model: model.split("/").pop()?.replace(/:free$/, "") ?? model } };
      last = `${model}: empty reply`;
    }
    return degrade(last);
  });
}
