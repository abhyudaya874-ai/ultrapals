import { openChat, parseChatSse, type ChatProvider } from "@/lib/integrations/chat";
import { defaultModelDeps } from "@/lib/computer/model";
import { exaSearch } from "@/lib/integrations/exa";
import { tavilySearch } from "@/lib/integrations/tavily";
import type { AdapterResult, WebSource } from "@/lib/integrations/types";
import { usedSources } from "./citations";
import { buildMessages, mergeSources, trimSources, type Source } from "./sources";

/** What the Ask thread renders. Same append-only rule as TraceEvent: a repeated step id supersedes. */
export type ResearchEvent =
  | { kind: "step"; id: string; label: string; state: "running" | "ok" | "error"; detail?: string; ms?: number }
  | { kind: "sources"; sources: Source[] }
  | { kind: "reasoning"; delta: string }
  | { kind: "answer"; delta: string }
  | { kind: "done"; used: number[]; provider: ChatProvider; model: string; ms: number }
  | { kind: "error"; message: string };

export interface Deps {
  searchers: { id: string; label: string; run: (q: string, s?: AbortSignal) => Promise<AdapterResult<WebSource[]>> }[];
  open: typeof openChat;
  models: { provider: ChatProvider; model: string }[];
}

/** Same roster as the agent loop (lib/computer/model.ts); every id is re-checked against the allowlist in openChat. */
export const defaultDeps: Deps = {
  searchers: [
    { id: "tavily", label: "Tavily", run: tavilySearch },
    { id: "exa", label: "Exa", run: exaSearch },
  ],
  open: openChat,
  models: defaultModelDeps.models,
};

export async function* research(question: string, signal?: AbortSignal, deps: Deps = defaultDeps): AsyncGenerator<ResearchEvent> {
  const t0 = Date.now();
  for (const s of deps.searchers) yield { kind: "step", id: `search-${s.id}`, label: `Searching the web with ${s.label}`, state: "running" };
  const found = await Promise.all(
    deps.searchers.map(async (s) => {
      const t = Date.now();
      return { s, r: await s.run(question, signal), ms: Date.now() - t };
    }),
  );
  for (const { s, r, ms } of found)
    yield { kind: "step", id: `search-${s.id}`, label: `Searched the web with ${s.label}`, state: r.ok ? "ok" : "error", detail: r.ok ? `${r.data.length} results` : r.reason, ms };

  const sources = trimSources(mergeSources(found.flatMap(({ r }) => (r.ok ? [r.data] : []))));
  if (sources.length === 0) {
    yield { kind: "error", message: `No web results (${found.flatMap(({ r }) => (r.ok ? [] : [r.reason])).join("; ") || "empty"}).` };
    return;
  }
  yield { kind: "sources", sources };

  for (const [i, m] of deps.models.entries()) {
    if (signal?.aborted) return;
    const id = `model-${i}`;
    const label = `Writing the answer with ${m.model.split("/").pop()} on ${m.provider}`;
    yield { kind: "step", id, label, state: "running" };
    const tm = Date.now();
    const opened = await deps.open(m.provider, m.model, buildMessages(question, sources), { signal });
    if (!opened.ok) {
      yield { kind: "step", id, label, state: "error", detail: opened.reason, ms: Date.now() - tm };
      continue;
    }
    const reader = opened.data.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let answer = "";
    let failed: string | null = null;
    try {
      read: for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const p = parseChatSse((buf += dec.decode(value, { stream: true })));
        buf = p.rest;
        for (const d of p.deltas) {
          if (d.error) {
            failed = d.error;
            break read;
          }
          if (d.reasoning) yield { kind: "reasoning", delta: d.reasoning };
          if (d.content) {
            answer += d.content;
            yield { kind: "answer", delta: d.content };
          }
        }
        if (p.done) break;
      }
    } catch (e) {
      failed = e instanceof Error ? e.message : "stream failed";
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (failed && !answer) {
      yield { kind: "step", id, label, state: "error", detail: failed, ms: Date.now() - tm };
      continue;
    }
    yield { kind: "step", id, label, state: failed ? "error" : "ok", detail: failed ?? undefined, ms: Date.now() - tm };
    if (!answer.trim()) {
      yield { kind: "step", id, label, state: "error", detail: "empty answer", ms: Date.now() - tm };
      continue;
    }
    yield { kind: "done", used: usedSources(answer, sources.length), provider: m.provider, model: m.model, ms: Date.now() - t0 };
    return;
  }
  yield { kind: "error", message: "Every free model is busy or rate-limited right now. Try again in a minute." };
}
