import type { ArenaMode } from "@/lib/arena/mode";
import type { Run } from "@/lib/computer/run";
import { MAIN_BASELINE_TOKENS, SMALLEST_WINDOW, estimateTokens } from "./tokens";

/**
 * One ring beside the send button: how much of a model's window an agent is using. Pure. A ring is made from what the model calls really
 * reported (or, where the provider sent no count, from the text that went in and came out) and says which. Before an agent has made a call it
 * shows what its instructions alone take, marked as an estimate.
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
}

const notStarted = (key: string, label: string, draft: number): Ring => ({ key, label, model: null, provider: null, used: MAIN_BASELINE_TOKENS + draft, window: SMALLEST_WINDOW, prompt: MAIN_BASELINE_TOKENS, completion: 0, draft, exact: false, calls: 0, tokens: 0, started: false });

/** Pure. A ring from the latest call UltraPal ("main") made in a run, or the not-started ring when it has made none. */
function fromRun(key: string, label: string, run: Run | undefined, draft: number): Ring {
  const main = run?.usage?.byAgent.main;
  if (!run || !main) return { ...notStarted(key, label, draft), tokens: run?.usage?.tokens ?? 0 };
  return { key, label, model: main.model, provider: main.provider, used: main.prompt + main.completion + draft, window: main.window, prompt: main.prompt, completion: main.completion, draft, exact: main.exact, calls: main.calls, tokens: run.usage?.tokens ?? 0, started: true };
}

/** Pure. The rings of a Battle or Loop that is in the thread: one per team or round, with the ones that have not started yet as placeholders. */
function arenaRings(run: Run): Ring[] {
  const a = run.arena!;
  const total = a.mode === "loop" ? Math.max(a.max, a.contenders.length) : a.contenders.length;
  return Array.from({ length: total }, (_, i) => {
    const c = a.contenders[i];
    const label = a.mode === "battle" ? `Team ${i + 1}${c ? ` · ${c.info.name}` : ""}` : `Round ${i + 1}${c?.info.scenarioName ? ` · ${c.info.scenarioName}` : ""}`;
    return fromRun(c?.info.id ?? `slot-${i}`, label, c?.run, 0);
  });
}

/**
 * Pure. The rings for the input box. A chat has one (UltraPal's latest call). A Battle has one per team and a Loop one per round: while a contest runs, or
 * while its results are on screen with nothing new typed and the same count chosen, each shows what that team really used; otherwise `mode.n`
 * placeholders show what each would start with.
 */
export function ringsFor(o: { mode: ArenaMode; runs: readonly Run[]; draft: string; busy: boolean }): Ring[] {
  const draft = estimateTokens(o.draft);
  if (o.mode.kind === "chat") {
    const run = [...o.runs].reverse().find((r) => !r.arena && r.usage?.byAgent.main);
    return [fromRun("chat", "UltraPal", run, draft)];
  }
  const last = o.runs.at(-1);
  const same = !!last?.arena && last.arena.mode === o.mode.kind;
  const count = last?.arena ? (last.arena.mode === "loop" ? last.arena.max : last.arena.contenders.length) : 0;
  const showRun = same && (o.busy || (o.draft.trim() === "" && count === o.mode.n));
  if (showRun && last) return arenaRings(last);
  return Array.from({ length: o.mode.n }, (_, i) => notStarted(`slot-${i}`, o.mode.kind === "battle" ? `Team ${i + 1}` : `Round ${i + 1}`, draft));
}
