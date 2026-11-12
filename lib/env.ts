import { z } from "zod";

// Blank values in .env.local ("APP_URL=") count as unset, so defaults apply.
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), s);

// "1" / "true" = on. Blank or anything else = off. Capability flags let a vendor be switched off with no code change.
const flag = z.preprocess((v) => v === "1" || v === "true", z.boolean());
const opt = () => blank(z.string().optional());

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_ENV: z.literal("sandbox"), // anything else is a startup crash on purpose
  APP_URL: blank(z.string().url().default("http://localhost:3000")),
  PUBLIC_URL: opt(), // public origin (quick tunnel) for URLs a cloud browser or the SSRF guard must reach; blank = APP_URL
  ANTHROPIC_API_KEY: opt(),

  // --- capability flags (see lib/integrations/registry.ts) ---
  CAP_STUDIO: flag,
  CAP_CHANNEL3: flag,
  CAP_KERNEL: flag,
  CAP_ELASTIC: flag,
  CAP_BRYNTUM: flag,
  CAP_ASTROPODS: flag,
  CAP_ZAPIER: flag,
  CAP_RENDER: flag,
  CAP_GROQ: flag,
  CAP_OPENROUTER: flag,
  CAP_NVIDIA: flag,
  CAP_TOKENROUTER: flag,
  CAP_BLUESMINDS: flag,
  CAP_TAVILY: flag,
  CAP_EXA: flag,
  AUTOMATIONS_SCHEDULER: blank(z.enum(["on", "off"]).default("on")), // "off" = the in-process timer never starts (use POST /api/automations/tick instead)
  // --- spending guards: what a public link may cost (see lib/budget). Cloud computers bill while alive; the others spend free-tier quota. ---
  KERNEL_MAX_BROWSERS: blank(z.coerce.number().int().min(1).max(50).default(6)), // cloud computers alive at once, whole server
  KERNEL_MAX_PER_DAY: blank(z.coerce.number().int().min(1).max(5000).default(150)), // cloud computers started in any 24 hours
  DAILY_RUN_CAP: blank(z.coerce.number().int().min(1).max(100000).default(250)), // chat messages in any 24 hours, everyone together
  DAILY_CONTEST_CAP: blank(z.coerce.number().int().min(1).max(10000).default(30)), // Battles and Loops in any 24 hours, everyone together
  AUTOMATIONS_TOKEN: opt(), // when set, POST /api/automations/tick requires it in x-automations-token
  PROCTOR_TOKEN: opt(), // when set, POST /api/proctor requires it in x-proctor-token
  CAP_STRIPE: flag,
  CAP_SQUARE: flag,

  // --- vendor credentials (all optional: a missing key means that capability is off) ---
  CHANNEL3_API_KEY: opt(),
  KERNEL_API_KEY: opt(),
  ELASTICSEARCH_URL: blank(z.string().url().optional()),
  ELASTIC_API_KEY: opt(),
  ASTROPODS_AGENT_URL: blank(z.string().url().optional()), // launch URL of the hosted concierge agent (a link, not an API)
  ZAPIER_MCP_TOKEN: opt(),
  ZAPIER_MCP_URL: blank(z.string().url().optional()), // optional full per-server MCP URL instead of the token
  ZAPIER_NUDGE_TOOL: blank(z.string().default("gmail_send_email")),
  RENDER_API_KEY: opt(),
  RENDER_WORKFLOW_TASK: blank(z.string().default("standing-promise-cycles/sweep")),
  STUDIO_LLM_BASE_URL: blank(z.string().url().optional()), // any OpenAI-compatible chat-completions base, e.g. https://api.openai.com/v1
  STUDIO_LLM_API_KEY: opt(),
  GROQ_API_KEY: opt(),
  OPENROUTER_API_KEY: opt(),
  NVIDIA_API_KEY: opt(),
  TOKENROUTER_API_KEY: opt(),
  BLUESMINDS_API_KEY: opt(),
  TAVILY_API_KEY: opt(),
  EXA_API_KEY: opt(),
  STRIPE_SANDBOX_KEY: opt(), // SuperPal examiners (D-RIVAL): keys arrive later; blank = that row is NOT_MEASURABLE
  SHOPIFY_SANDBOX_KEY: opt(),
  APPLE_SANDBOX_KEY: opt(),
  ADYEN_SANDBOX_KEY: opt(),
  WISE_SANDBOX_KEY: opt(),
  KLARNA_SANDBOX_KEY: opt(),
  SQUARE_SANDBOX_KEY: opt(),
  COINBASE_SANDBOX_KEY: opt(),
  PAYPAL_SANDBOX_BUYER_EMAIL: opt(), // scripted approval on the live browser; never sent to a model
  PAYPAL_SANDBOX_BUYER_PASSWORD: opt(),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | undefined;

/**
 * Pure. On Render the service is told its own public address (RENDER_EXTERNAL_URL), so a deploy that did not set APP_URL uses that one instead of
 * localhost: PayPal's return URL and the app's calls to its own routes then point at the real site with no second pass. An APP_URL that is set always wins.
 */
export function withRenderUrl(e: Record<string, string | undefined>): Record<string, string | undefined> {
  return e.APP_URL || !e.RENDER_EXTERNAL_URL ? e : { ...e, APP_URL: e.RENDER_EXTERNAL_URL };
}

/** Lazy + memoised so `next build` works without secrets. Crashes readably. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(withRenderUrl(process.env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}\nCopy env.example to .env.local and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}

/** The origin a cloud browser or the SSRF-guarded fetch must be able to reach: PUBLIC_URL when set (tunnel), else APP_URL. */
export function publicBase(): string {
  const e = getEnv();
  return (e.PUBLIC_URL ?? e.APP_URL).replace(/\/+$/, "");
}
