import type { ArenaMode } from "@/lib/arena/mode";
import { palName } from "@/lib/computer/pals";
import type { Run } from "@/lib/computer/run";
import { collectiveFor, type AgentLoad } from "./context";
import { MAIN_BASELINE_TOKENS, SMALLEST_WINDOW, estimateTokens } from "./tokens";

/**
 * One ring beside the send button: how much context a whole team is using. Pure. A chat's ring adds up UltraPal and every Pal it sent out (BrowserPal,
 * TerminalPal, ResearchPal ...); a Battle has one ring per team and a Loop one per round, each adding up that team's own agents. Every number is what the
 * model calls really reported (or, where the provider sent no count, an estimate from the text that went in and came out) and the ring says which, and it
 * moves while a call streams. Before any agent has made a call it shows what UltraPal's instructions alone take, marked as an estimate.
 */
export interface Ring {
  key: string;
  /** Who: UltraPal, "Team 2 · Skeptic", "Round 3 · Half the budget". */
  label: string;
  /** The provider's id of the model that made the latest call, null before any call. */
  model: string | null;
  provider: string | null;
  /** Tokens in use: the latest call's prompt and reply, plus what the typed message will add. */
  used: number;
  window: number;
  prompt: number;
  completion: number;
  /** What the message being typed adds (estimated). */
  draft: number;
  /** Counted by the provider; false when estimated or when no call has been made. */
  exact: boolean;
  /** Calls this agent has made in the run. */
  calls: number;
  /** Tokens spent by the whole run this agent belongs to, every call, prompts and replies. */
  tokens: number;
  /** A real call has been made. */
  started: boolean;
  /** Each agent's share, UltraPal first: what the ring adds up. */
  agents: AgentLoad[];
  /** The fullest single agent, in percent of its own window. The ring turns amber and red on this, not on the sum. */
  worst: number;
  /** Agents still working. */
  working: number;
  /** The call that these numbers describe is still running: the reply count is an estimate that grows with the stream. */
  live: boolean;
}

const notStarted = (key: string, label: string, draft: number): Ring => ({ key, label, model: null, provider: null, used: MAIN_BASELINE_TOKENS + draft, window: SMALLEST_WINDOW, prompt: MAIN_BASELINE_TOKENS, completion: 0, draft, exact: false, calls: 0, tokens: 0, started: false, live: false, agents: [], worst: 0, working: 0 });

/** Pure. A ring from every agent of a run, or the not-started ring when none has called a model yet. `nameOf` renames agents where "UltraPal" would be wrong. */
function fromRun(key: string, label: string, run: Run | undefined, draft: number, nameOf?: (id: string) => string): Ring {
  const c = collectiveFor(run, nameOf);
  if (!run || !c) return { ...notStarted(key, label, draft), tokens: run?.usage?.tokens ?? 0 };
  const lead = c.agents[0];
  return {
    key, label, model: lead.model, provider: lead.provider,
    used: c.used + draft, window: c.window,
    prompt: c.agents.reduce((n, a) => n + a.prompt, 0), completion: c.agents.reduce((n, a) => n + a.completion, 0),
    draft, exact: c.exact, calls: c.calls, tokens: c.spent, started: true, live: c.live,
    agents: c.agents, worst: c.worst, working: c.working,
  };
}

/** Pure. The rings of a Battle or Loop that is in the thread: one per team or round, with the ones that have not started yet as placeholders. */
function arenaRings(run: Run): Ring[] {
  const a = run.arena!;
  const total = a.mode === "loop" ? Math.max(a.max, a.contenders.length) : a.contenders.length;
  return Array.from({ length: total }, (_, i) => {
    const c = a.contenders[i];
    const label = a.mode === "battle" ? `Team ${i + 1}${c ? ` · ${c.info.name}` : ""}` : `Round ${i + 1}${c?.info.scenarioName ? ` · ${c.info.scenarioName}` : ""}`;
    return fromRun(c?.info.id ?? `slot-${i}`, label, c?.run, 0);
  }).concat(run.usage ? [fromRun("contest", "Judge and writer", run, 0, (id) => (id === "main" ? "Judge and writer" : palName(id)))] : []);
}

/**
 * Pure. The rings for the input box. A chat has one (UltraPal's latest call). A Battle has one per team and a Loop one per round: while a contest runs, or
 * while its results are on screen with nothing new typed and the same count chosen, each shows what that team really used; otherwise `mode.n`
 * placeholders show what each would start with.
 */
export function ringsFor(o: { mode: ArenaMode; runs: readonly Run[]; draft: string; busy: boolean }): Ring[] {
  const draft = estimateTokens(o.draft);
  if (o.mode.kind === "chat") {
    const run = [...o.runs].reverse().find((r) => !r.arena && r.usage && Object.keys(r.usage.byAgent).length > 0);
    return [fromRun("chat", "UltraPal", run, draft)];
  }
  const last = o.runs.at(-1);
  const same = !!last?.arena && last.arena.mode === o.mode.kind;
  const count = last?.arena ? (last.arena.mode === "loop" ? last.arena.max : last.arena.contenders.length) : 0;
  const showRun = same && (o.busy || (o.draft.trim() === "" && count === o.mode.n));
  if (showRun && last) return arenaRings(last);
  return Array.from({ length: o.mode.n }, (_, i) => notStarted(`slot-${i}`, o.mode.kind === "battle" ? `Team ${i + 1}` : `Round ${i + 1}`, draft));
}
