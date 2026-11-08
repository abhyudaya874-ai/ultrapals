import type { openChat } from "@/lib/integrations/chat";
import type { LiveBrowser } from "@/lib/integrations/kbrowser";
import type { Snapshot } from "@/lib/browse/snapshot";
import type { CEvent } from "./events";
import type { Deps } from "./ctx";
import type { Session } from "./session";

/** Test doubles for the agent loops. Not imported by application code. */
const sse = (text: string, reasoning?: string): string =>
  (reasoning ? `data: ${JSON.stringify({ choices: [{ delta: { reasoning } }] })}\n\n` : "") + `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;

export const stream = (t: string): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } });

/** Each model call returns the next scripted reply (a string, or a function of the call index). Records the prompts it saw. */
export function scripted(replies: (string | { reasoning: string; text: string })[]) {
  const prompts: string[] = [];
  let i = 0;
  const open = (async (provider: "groq" | "openrouter", model: string, messages: { content: string }[]) => {
    prompts.push(messages.map((m) => m.content).join("\n---\n"));
    const r = replies[Math.min(i++, replies.length - 1)];
    const [text, reasoning] = typeof r === "string" ? [r, undefined] : [r.text, r.reasoning];
    return { ok: true as const, data: { provider, model, body: stream(sse(text, reasoning)) } };
  }) as unknown as typeof openChat;
  return { open, prompts, calls: () => i };
}

export const VM: LiveBrowser = { id: "vm-1", liveViewUrl: "https://a.kernel.sh:8443/browser/live/T", offX: 0, offY: 87 };
export const mkSession = (o: Partial<Session> = {}): Session => ({ id: "s1", vm: VM, vmOpening: null, sources: [], history: [], busy: false, lastUsed: 0, seq: 0, ...o });

export const page = (url: string, title: string, text = "text", elements: Snapshot["elements"] = []): Snapshot => ({ url, title, text, elements });
export const ok = <T>(data: T) => ({ ok: true as const, data });

export async function collect<R>(g: AsyncGenerator<CEvent, R>): Promise<{ ev: CEvent[]; ret: R }> {
  const ev: CEvent[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { ev, ret: n.value };
    ev.push(n.value);
  }
}

export type DepsPatch = { [K in keyof Deps]?: Partial<Deps[K]> | Deps[K] };
export function mkDeps(open: ReturnType<typeof scripted>["open"], patch: DepsPatch = {}): Deps {
  const never = async () => ({ ok: false as const, degraded: true as const, reason: "not faked" });
  const base = {
    model: { open, now: () => 1000, models: [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }] },
    vm: { open: async () => ok(VM), snapshot: never, goto: never, click: never, type: never, scroll: never },
    term: { exec: never, write: never, read: never, serve: never },
    search: [],
    research: async function* () { /* nothing */ },
  };
  return { ...base, ...patch, vm: { ...base.vm, ...patch.vm }, term: { ...base.term, ...patch.term }, model: { ...base.model, ...patch.model } } as unknown as Deps;
}
