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
  CAP_TAVILY: flag,
  CAP_EXA: flag,

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
  TAVILY_API_KEY: opt(),
  EXA_API_KEY: opt(),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | undefined;

/** Lazy + memoised so `next build` works without secrets. Crashes readably. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}\nCopy env.example to .env.local and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}
