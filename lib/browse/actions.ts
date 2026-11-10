import { z } from "zod";

/** Keys the agent may press. A closed list: nothing that opens browser menus, closes tabs or shortcuts out of the page. */
export const BROWSER_KEYS = ["Enter", "Tab", "Escape", "Backspace", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"] as const;
export type BrowserKey = (typeof BROWSER_KEYS)[number];

/** One browser step. `pay` is the only action that touches money, and it only ever creates a Standing Promise (see lib/browse/pay.ts). */
export const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), query: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("goto"), url: z.string().trim().url().max(500) }),
  z.object({ action: z.literal("click"), index: z.number().int().min(0).max(500) }),
  z.object({ action: z.literal("type"), index: z.number().int().min(0).max(500), text: z.string().max(300), submit: z.boolean().optional() }),
  z.object({ action: z.literal("scroll"), direction: z.enum(["down", "up"]).default("down"), to: z.enum(["top", "bottom"]).optional() }),
  z.object({ action: z.literal("key"), key: z.enum(BROWSER_KEYS) }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("forward") }),
  z.object({ action: z.literal("reload") }),
  z.object({ action: z.literal("wait"), seconds: z.number().min(1).max(8).default(2) }),
  z.object({ action: z.literal("find"), text: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("select"), index: z.number().int().min(0).max(500), option: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("handoff"), reason: z.string().trim().min(5).max(240) }),
  z.object({ action: z.literal("pay") }),
  z.object({ action: z.literal("finish"), answer: z.string().trim().min(1).max(3000) }),
]);
export type Action = z.infer<typeof Action>;

/** `note` is what the model chose to write down from this page (a price and where it saw it); it is absent when the model wrote nothing. */
export type Parsed = { ok: true; thought: string; note?: string; action: Action } | { ok: false; error: string };

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
  const written = (json as { note?: unknown }).note;
  const note = typeof written === "string" ? written.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return { ok: true, thought, ...(note ? { note } : {}), action: parsed.data };
}

/** Short human line for the thread: "Clicked [3] Pay with PayPal". */
export function describeAction(a: Action, label?: string): string {
  switch (a.action) {
    case "search": return `Searching the web for "${a.query}"`;
    case "goto": return `Opening ${a.url}`;
    case "click": return `Clicking [${a.index}]${label ? ` ${label}` : ""}`;
    case "type": {
      // what goes into a password field is never written into the thread
      const secret = label?.trim().toLowerCase() === "password";
      const shown = secret ? "" : ` "${a.text.length > 40 ? `${a.text.slice(0, 39)}…` : a.text}"`;
      return `Typing${shown} into [${a.index}]${label ? ` ${label}` : ""}${a.submit ? " and pressing Enter" : ""}`;
    }
    case "scroll": return a.to ? `Scrolling to the ${a.to}` : `Scrolling ${a.direction}`;
    case "key": return `Pressing ${a.key}`;
    case "back": return "Going back";
    case "forward": return "Going forward";
    case "reload": return "Reloading the page";
    case "wait": return `Waiting ${a.seconds} second${a.seconds === 1 ? "" : "s"}`;
    case "find": return `Looking for "${a.text}" on the page`;
    case "select": return `Choosing "${a.option}" in [${a.index}]${label ? ` ${label}` : ""}`;
    case "read": return "Reading the page";
    case "handoff": return `Asking you for help: ${a.reason}`;
    case "pay": return "Paying with a Standing Promise";
    case "finish": return "Writing the answer";
  }
}
