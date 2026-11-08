import type { Source } from "@/lib/research/sources";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { mergeInto, remapCitations } from "./session";

/**
 * The research subagent: parallel Tavily + Exa, then a free model writes a cited answer (lib/research/run.ts).
 * Its local [n] are remapped to the session's shared numbering so every agent cites the same source list.
 */
export async function* runResearchAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, session, deps } = ctx;
  let answer = "";
  let local: Source[] = [];
  let error: string | null = null;
  for await (const e of deps.research(task, ctx.signal)) {
    if (e.kind === "step") yield { kind: "step", agent, id: e.id, label: e.label, state: e.state, detail: e.detail, ms: e.ms };
    else if (e.kind === "reasoning") yield { kind: "reasoning", agent, delta: e.delta };
    else if (e.kind === "sources") local = e.sources;
    else if (e.kind === "answer") answer += e.delta;
    else if (e.kind === "error") error = e.message;
  }
  if (!answer.trim()) return `Research failed: ${error ?? "no answer"}`;
  const m = mergeInto(session.sources, local);
  session.sources = m.sources;
  yield { kind: "sources", sources: m.sources };
  return remapCitations(answer, m.map);
}
