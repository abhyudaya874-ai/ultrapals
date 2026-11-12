import { buildMessages, type Source } from "@/lib/research/sources";
import { defaultDeps as researchDefaults } from "@/lib/research/run";
import { contextWindow, estimateTokens, messagesTokens } from "@/lib/usage/tokens";
import { LIVE_MS } from "./model";
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
  let thought = "";
  let wrote: { model: string; provider: string } | null = null;
  // while the answer is being written the agent tells the context ring what it has used so far, the way a model call does
  let writing: { model: string; provider: string; prompt: number } | null = null;
  let lastLive = 0;
  const live = deps.model.live === true;
  const tell = (completion: number): CEvent => ({ kind: "usage_live", agent, prompt: writing!.prompt, completion, window: contextWindow(writing!.model), model: writing!.model, provider: writing!.provider });
  // The answer is written on this run's own model order (a Battle team's model first), not every team on the same first model.
  for await (const e of deps.research(task, ctx.signal, { ...researchDefaults, open: deps.model.open, models: deps.model.models })) {
    if (e.kind === "step") {
      yield { kind: "step", agent, id: e.id, label: e.label, state: e.state, detail: e.detail, ms: e.ms };
      if (e.id === "search-tavily" || e.id === "search-exa") {
        const count = /^(\d+) results/.exec(e.detail ?? "")?.[1];
        yield searchVisit(agent, `${agent}:${e.id}`, task, e.id === "search-exa" ? "exa" : "tavily", e.state, count ? Number(count) : undefined);
      }
    }
    else if (e.kind === "model") {
      writing = { model: e.model, provider: e.provider, prompt: messagesTokens(buildMessages(task, local)) };
      answer = ""; // a model that failed half way is replaced by the next one
      thought = "";
      lastLive = deps.model.now();
      if (live) yield tell(0);
    }
    else if (e.kind === "reasoning") {
      thought += e.delta;
      yield { kind: "reasoning", agent, delta: e.delta };
      if (live && writing && deps.model.now() - lastLive >= LIVE_MS) { lastLive = deps.model.now(); yield tell(estimateTokens(answer) + estimateTokens(thought)); }
    }
    else if (e.kind === "done") wrote = { model: e.model, provider: e.provider };
    else if (e.kind === "sources") {
      local = e.sources;
      for (const s of e.sources) yield readVisit(agent, s.url, s.title, s.provider === "exa" ? "exa" : "tavily");
    }
    else if (e.kind === "answer") {
      answer += e.delta;
      if (live && writing && deps.model.now() - lastLive >= LIVE_MS) { lastLive = deps.model.now(); yield tell(estimateTokens(answer) + estimateTokens(thought)); }
    }
    else if (e.kind === "error") error = e.message;
  }
  if (!answer.trim()) return `Research failed: ${error ?? "no answer"}`;
  // The research loop has its own model call, so its tokens are told here (estimated from what went in and what came out) for the agent's panel and the run's total.
  if (wrote) yield { kind: "usage", agent, prompt: messagesTokens(buildMessages(task, local)), completion: estimateTokens(answer) + estimateTokens(thought), window: contextWindow(wrote.model), model: wrote.model, provider: wrote.provider, exact: false };
  const m = mergeInto(session.sources, local);
  session.sources = m.sources;
  yield { kind: "sources", sources: m.sources };
  const cited = remapCitations(answer, m.map);
  // The findings become files the next step (and the final answer) can read: a CSV of what was found and a short note with the answer.
  yield* writeArtifact(ctx, `${agent}-sources.csv`, csvOf(["n", "title", "host", "url", "found_by", "published", "snippet"], local.map((s, i) => [m.map[i] ?? s.n, s.title, s.host, s.url, s.provider, s.publishedDate?.slice(0, 10) ?? "", s.snippet.slice(0, 220)])));
  yield* writeArtifact(ctx, `${agent}-notes.md`, `# ${task.slice(0, 120)}\n\n${cited}\n`);
  return cited;
}
