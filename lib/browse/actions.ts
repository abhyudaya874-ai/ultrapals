import { z } from "zod";

/** One browser step. `pay` is the only action that touches money, and it only ever creates a Standing Promise (see lib/browse/pay.ts). */
export const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), query: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("goto"), url: z.string().trim().url().max(500) }),
  z.object({ action: z.literal("click"), index: z.number().int().min(0).max(500) }),
  z.object({ action: z.literal("type"), index: z.number().int().min(0).max(500), text: z.string().max(300), submit: z.boolean().optional() }),
  z.object({ action: z.literal("scroll"), direction: z.enum(["down", "up"]) }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("pay") }),
  z.object({ action: z.literal("finish"), answer: z.string().trim().min(1).max(3000) }),
]);
export type Action = z.infer<typeof Action>;

export type Parsed = { ok: true; thought: string; action: Action } | { ok: false; error: string };

/** First balanced {...} in the text, ignoring braces inside strings. Models wrap JSON in prose, fences or <think> blocks. */
export function extractJson(text: string): string | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return t.slice(start, i + 1);
  }
  return null;
}

/** Pure. Never throws; the loop feeds `error` back to the model so it can correct itself. */
export function parseAction(text: string): Parsed {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: "reply must be a single JSON object" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "reply was not valid JSON" };
  }
  const parsed = Action.safeParse(json);
  if (!parsed.success) return { ok: false, error: `invalid action: ${parsed.error.issues.map((i) => `${i.path.join(".") || "action"} ${i.message}`).join("; ")}` };
  const thought = typeof (json as { thought?: unknown }).thought === "string" ? (json as { thought: string }).thought.slice(0, 400) : "";
  return { ok: true, thought, action: parsed.data };
}

/** Short human line for the thread: "Clicked [3] Pay with PayPal". */
export function describeAction(a: Action, label?: string): string {
  switch (a.action) {
    case "search": return `Searching the web for "${a.query}"`;
    case "goto": return `Opening ${a.url}`;
    case "click": return `Clicking [${a.index}]${label ? ` ${label}` : ""}`;
    case "type": return `Typing into [${a.index}]${label ? ` ${label}` : ""}${a.submit ? " and pressing Enter" : ""}`;
    case "scroll": return `Scrolling ${a.direction}`;
    case "read": return "Reading the page";
    case "pay": return "Paying with a Standing Promise";
    case "finish": return "Writing the answer";
  }
}
