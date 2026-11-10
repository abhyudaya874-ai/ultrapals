import type { Source } from "@/lib/research/sources";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { writeArtifact, csvOf } from "./artifacts";
import { mergeInto, remapCitations } from "./session";
import { readVisit, searchVisit } from "./visits";

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
    if (e.kind === "step") {
      yield { kind: "step", agent, id: e.id, label: e.label, state: e.state, detail: e.detail, ms: e.ms };
      if (e.id === "search-tavily" || e.id === "search-exa") {
        const count = /^(\d+) results/.exec(e.detail ?? "")?.[1];
        yield searchVisit(agent, `${agent}:${e.id}`, task, e.id === "search-exa" ? "exa" : "tavily", e.state, count ? Number(count) : undefined);
      }
    }
    else if (e.kind === "reasoning") yield { kind: "reasoning", agent, delta: e.delta };
    else if (e.kind === "sources") {
      local = e.sources;
      for (const s of e.sources) yield readVisit(agent, s.url, s.title, s.provider === "exa" ? "exa" : "tavily");
    }
    else if (e.kind === "answer") answer += e.delta;
    else if (e.kind === "error") error = e.message;
  }
  if (!answer.trim()) return `Research failed: ${error ?? "no answer"}`;
  const m = mergeInto(session.sources, local);
  session.sources = m.sources;
  yield { kind: "sources", sources: m.sources };
  const cited = remapCitations(answer, m.map);
  // The findings become files the next step (and the final answer) can read: a CSV of what was found and a short note with the answer.
  yield* writeArtifact(ctx, `${agent}-sources.csv`, csvOf(["n", "title", "host", "url", "found_by", "published", "snippet"], local.map((s, i) => [m.map[i] ?? s.n, s.title, s.host, s.url, s.provider, s.publishedDate?.slice(0, 10) ?? "", s.snippet.slice(0, 220)])));
  yield* writeArtifact(ctx, `${agent}-notes.md`, `# ${task.slice(0, 120)}\n\n${cited}\n`);
  return cited;
}
