import { canonicalUrl } from "@/lib/research/sources";
import type { AgentRow, FileEdit, ModelUse, Run, Step, TermBlock } from "./run";
import { groupVisits, type Grouped, type Visit } from "./visits";

/** One page an agent read: where, what it was called, and the number the answer cites it by (null when the answer did not cite it). */
export interface PageRow {
  url: string;
  title: string;
  host: string;
  via?: string;
  n: number | null;
}

/**
 * Everything one subagent did in a run, gathered for its own panel. Pure: it reads what the event stream already built and invents nothing.
 * A field is empty when the agent did not do that kind of work (a script has no models, a researcher has no commands).
 */
export interface AgentReport {
  agent: AgentRow;
  /** What UltraPal (or the Pal above it) asked this agent to do, word for word. */
  task: string | null;
  /** What it handed back. */
  result: string | null;
  /** Every model it used, with its calls and tokens, in the order first used. */
  models: ModelUse[];
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** A model call is running right now. */
  thinking: boolean;
  steps: { total: number; ok: number; failed: number; running: number };
  commands: TermBlock[];
  files: FileEdit[];
  searches: Visit[];
  /** Pages it read, grouped by site, each page once. */
  hosts: Grouped["hosts"];
  /** The same pages as one flat list, in the order read, each with the citation number the run gave it. */
  pageRows: PageRow[];
  pages: number;
  /** Agents that report to this one. */
  helpers: AgentRow[];
  thoughtChars: number;
}

/** Pure. The latest run in the conversation that has an agent with this id (ids such as `research-1` repeat in every turn). */
export function findRun(runs: readonly Run[], id: string): Run | undefined {
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].agents.some((a) => a.id === id)) return runs[i];
  return undefined;
}

const keyOf = (u: string): string => {
  try {
    return canonicalUrl(u);
  } catch {
    return u;
  }
};

/** Pure. The browser agent's page reads are tagged "browser" by the stream, not with its own id. */
const mine = (agent: AgentRow, v: Visit): boolean => v.agent === agent.id || (agent.role === "browser" && v.agent === "browser");

/** Pure. The report for one agent of a run, or null when the run has no such agent. */
export function reportFor(run: Run, id: string): AgentReport | null {
  const agent = run.agents.find((a) => a.id === id);
  if (!agent) return null;
  const models = run.usage?.models?.[id] ?? [];
  const note = run.usage?.byAgent[id];
  const visits = run.visits.filter((v) => mine(agent, v));
  const grouped = groupVisits(visits);
  const cited = new Map(run.sources.map((x) => [keyOf(x.url), x.n]));
  const pageRows = grouped.hosts.flatMap((h) => h.pages.map((p) => ({ url: p.url!, title: p.title ?? h.host, host: h.host, ...(p.via ? { via: p.via } : {}), n: cited.get(keyOf(p.url!)) ?? null })));
  const said = run.messages.filter((m) => m.from === id);
  const stepsBy = (state: Step["state"]): number => agent.steps.filter((s) => s.state === state).length;
  return {
    agent,
    task: run.messages.find((m) => m.to === id && m.id === `to-${id}`)?.text ?? run.messages.find((m) => m.to === id)?.text ?? null,
    result: said.at(-1)?.text ?? null,
    models,
    calls: models.reduce((n, m) => n + m.calls, 0),
    tokensIn: models.reduce((n, m) => n + m.prompt, 0),
    tokensOut: models.reduce((n, m) => n + m.completion, 0),
    thinking: note?.live === true && agent.state === "running",
    steps: { total: agent.steps.length, ok: stepsBy("ok"), failed: stepsBy("error"), running: stepsBy("running") },
    commands: agent.terms,
    files: agent.files,
    searches: grouped.searches,
    hosts: grouped.hosts,
    pageRows,
    pages: grouped.pages,
    helpers: run.agents.filter((a) => a.parent === id),
    thoughtChars: agent.reasoning.length,
  };
}

const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Pure. The one-line tally under the title, listing only what the agent actually did. "Did nothing yet" when it has not. */
export function tally(r: AgentReport): string[] {
  const out: string[] = [];
  if (r.calls > 0) out.push(plural(r.calls, "model call"));
  if (r.commands.length > 0) out.push(plural(r.commands.length, "command"));
  if (r.files.length > 0) out.push(plural(r.files.length, "file"));
  if (r.searches.length > 0) out.push(plural(r.searches.length, "search", "searches"));
  if (r.pages > 0) out.push(`${plural(r.pages, "page")} read`);
  if (r.helpers.length > 0) out.push(plural(r.helpers.length, "helper"));
  if (out.length === 0 && r.steps.total > 0) out.push(plural(r.steps.total, "step"));
  return out;
}

/** Pure. "gpt-oss-120b" from "openai/gpt-oss-120b", and the provider beside it. */
export const modelName = (m: Pick<ModelUse, "model" | "provider">): string => `${m.model.split("/").pop() ?? m.model} · ${m.provider}`;

/** Pure. What to say where the models would be listed when there are none. */
export function noModelsNote(r: AgentReport): string {
  if (r.thinking || (r.agent.state === "running" && r.calls === 0)) return "Waiting for its first model call.";
  return r.agent.reasoning ? "No model call was counted for this agent." : "No model call. This Pal worked as a script.";
}
