import { getEnv, type Env } from "@/lib/env";
import type { AdapterResult } from "./types";

export const CAPABILITY_IDS = ["studio", "channel3", "kernel", "elastic", "bryntum", "astropods", "zapier", "render", "groq", "openrouter", "nvidia", "tokenrouter", "bluesminds", "tavily", "exa", "stripe", "square"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

interface Capability {
  on: (e: Env) => boolean; // flag AND the credentials it needs. Read at CALL time, never at module load.
  note: string; // honest description of what happens when it is off
}

const CAPABILITIES: Record<CapabilityId, Capability> = {
  studio: { on: (e) => e.CAP_STUDIO, note: "dashboard surface; off = trace page only" },
  channel3: { on: (e) => e.CAP_CHANNEL3 && !!e.CHANNEL3_API_KEY, note: "product conditions; off = manual price entry" },
  kernel: { on: (e) => e.CAP_KERNEL && !!e.KERNEL_API_KEY, note: "browser observation + replay; off = plain fetch" },
  elastic: { on: (e) => e.CAP_ELASTIC && !!e.ELASTICSEARCH_URL && !!e.ELASTIC_API_KEY, note: "precedent search; off = no precedent line" },
  bryntum: { on: (e) => e.CAP_BRYNTUM, note: "timeline surface; off = table" },
  astropods: { on: (e) => e.CAP_ASTROPODS && !!e.ASTROPODS_AGENT_URL, note: "link to the hosted Promise concierge agent; off = no link" },
  zapier: { on: (e) => e.CAP_ZAPIER && (!!e.ZAPIER_MCP_TOKEN || !!e.ZAPIER_MCP_URL), note: "email nudges; off = in-app banner" },
  render: { on: (e) => e.CAP_RENDER && !!e.RENDER_API_KEY, note: "durable sweep tasks; off = settle in-request only" },
  groq: { on: (e) => e.CAP_GROQ && !!e.GROQ_API_KEY, note: "fast free-tier answers + reasoning; off = next provider in the rotation" },
  openrouter: { on: (e) => e.CAP_OPENROUTER && !!e.OPENROUTER_API_KEY, note: "free-only (:free) model fallback; off = other providers" },
  nvidia: { on: (e) => e.CAP_NVIDIA && !!e.NVIDIA_API_KEY, note: "NIM flash models (deepseek-v4.1-flash, glm-5.3-flash); off = other providers" },
  tokenrouter: { on: (e) => e.CAP_TOKENROUTER && !!e.TOKENROUTER_API_KEY, note: "routed gateway models (grok-4.1-fast, deepseek); off = other providers" },
  bluesminds: { on: (e) => e.CAP_BLUESMINDS && !!e.BLUESMINDS_API_KEY, note: "credit-funded gateway models (nemotron lightning, kimi-k3); off = other providers" },
  tavily: { on: (e) => e.CAP_TAVILY && !!e.TAVILY_API_KEY, note: "web search with snippets; off = Exa only" },
  stripe: { on: (e) => e.CAP_STRIPE && !!e.STRIPE_SANDBOX_KEY?.startsWith("sk_test_"), note: "Stripe TEST-mode probes for SituationPal; a live key is refused; off = rows are NOT_MEASURABLE" },
  square: { on: (e) => e.CAP_SQUARE && !!e.SQUARE_SANDBOX_KEY, note: "Square SANDBOX probes (host is hard-coded to the sandbox); off = rows are NOT_MEASURABLE" },
  exa: { on: (e) => e.CAP_EXA && !!e.EXA_API_KEY, note: "semantic web search with highlights; off = Tavily only" },
};

export function isOn(id: CapabilityId): boolean {
  return CAPABILITIES[id].on(getEnv());
}

export function degrade(reason: string): { ok: false; degraded: true; reason: string } {
  return { ok: false, degraded: true, reason };
}

/** Wrap EVERY adapter body in this. A thrown error becomes a degraded result. check-invariants enforces it. */
export async function guard<T>(id: CapabilityId, fn: () => Promise<AdapterResult<T>>): Promise<AdapterResult<T>> {
  try {
    return await fn();
  } catch (err) {
    return degrade(`${id}: ${err instanceof Error ? err.message : "failed"}`);
  }
}

export function capabilityReport(): { id: CapabilityId; on: boolean; note: string }[] {
  const env = getEnv();
  return CAPABILITY_IDS.map((id) => ({ id, on: CAPABILITIES[id].on(env), note: CAPABILITIES[id].note }));
}
