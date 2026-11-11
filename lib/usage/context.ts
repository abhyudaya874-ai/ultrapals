import { reportFor } from "@/lib/computer/agent-report";
import { palName } from "@/lib/computer/pals";
import type { Run } from "@/lib/computer/run";
import { percentOf } from "./tokens";

/** What one agent has done besides thinking: the work whose results land in a later prompt. */
export interface ToolTally {
  /** Steps it took: for BrowserPal each click, scroll or read; for the rest, its numbered steps. */
  steps: number;
  commands: number;
  files: number;
  searches: number;
  pages: number;
  /** Pals it sent out (a refused spawn does not count). */
  spawned: number;
  /** Messages it sent to another agent: its briefs and its reports. */
  messages: number;
}

/** One agent's share of the context in use: the latest model call it made, its window, and what it did around that call. */
export interface AgentLoad {
  id: string;
  /** "UltraPal", "BrowserPal", "TerminalPal" ... */
  name: string;
  state: "running" | "ok" | "error" | null;
  /** The model of its latest call, null when it has made none (a script, or a Pal that has only just started). */
  model: string | null;
  provider: string | null;
  /** What its latest call holds: the prompt it was given plus the reply (live while it streams). */
  used: number;
  /** The smallest window among the models this agent has been on. */
  window: number;
  /** Whole percent of its own window. */
  pct: number;
  /** The two parts of `used`: what was sent and what came back. */
  prompt: number;
  completion: number;
  exact: boolean;
  /** A call of this agent is running right now. */
  live: boolean;
  /** What it is doing at this moment: asked a model and not heard back ("waiting"), hearing the reply ("writing"), running a tool or a step ("working"), or nothing. */
  doing: "waiting" | "writing" | "working" | null;
  /** The step it is on while it works (a page it is opening, a command it is running), when there is one. */
  step: string | null;
  /** Finished calls. */
  calls: number;
  /** Tokens its finished calls spent, prompts and replies. */
  spent: number;
  tools: ToolTally;
}

/** Every agent of one run, added up. */
export interface Collective {
  /** The agent that spoke first (UltraPal) leads; the others follow in the order they appeared. */
  agents: AgentLoad[];
  /** Tokens in use across all agents right now, and the combined size of their windows. */
  used: number;
  window: number;
  /** The fullest single agent, in percent of its own window: the one that will forget first. */
  worst: number;
  /** Tokens spent by every call of every agent, finished or still running. */
  spent: number;
  /** Finished calls, all agents. */
  calls: number;
  /** An agent is mid-call. */
  live: boolean;
  /** Every number is the provider's own count (false while anything streams or was estimated). */
  exact: boolean;
  /** Agents still running. */
  working: number;
}

export const toolTotal = (t: ToolTally): number => t.steps + t.commands + t.files + t.searches + t.pages + t.spawned + t.messages;

/**
 * Pure. The context in use across every agent of a run: UltraPal, each Pal it sent out, and the Pals they sent out in turn. An agent counts once it has made
 * a model call (or has one running), at the size of its latest call, against the smallest window among the models it has been on. Agents are not summed into one window by pretending they share it: `used` and `window` are
 * both sums, and `worst` says how full the fullest single agent is. Null when nothing has called a model yet.
 */
export function collectiveFor(run: Run | undefined, nameOf: (id: string) => string = palName): Collective | null {
  const usage = run?.usage;
  if (!run || !usage) return null;
  const ids = [...run.agents.map((a) => a.id), ...Object.keys(usage.byAgent).filter((k) => !run.agents.some((a) => a.id === k))];
  const first = ids.includes("main") ? ["main", ...ids.filter((i) => i !== "main")] : ids;
  const agents: AgentLoad[] = [];
  for (const id of first) {
    const note = usage.byAgent[id];
    const row = run.agents.find((a) => a.id === id);
    if (!note && !row) continue;
    const rep = reportFor(run, id);
    const tools: ToolTally = {
      steps: rep?.steps.total ?? 0, commands: rep?.commands.length ?? 0, files: rep?.files.length ?? 0, searches: rep?.searches.length ?? 0, pages: rep?.pages ?? 0,
      spawned: new Set([...run.spawns.filter((x) => x.parent === id && x.decision !== "denied").map((x) => x.child), ...run.agents.filter((a) => a.parent === id).map((a) => a.id)]).size,
      messages: run.messages.filter((m) => m.from === id).length,
    };
    const step = row?.state === "running" ? ([...row.steps].reverse().find((x) => x.state === "running")?.label ?? null) : null;
    if (!note) {
      // An agent that has not called a model yet (BrowserPal starting its cloud computer, a script) is on the list at once, with nothing in use and no window of its own,
      // so a Pal that was just sent out shows up the moment it starts and adds nothing to the sums.
      agents.push({
        id, name: nameOf(id), state: row?.state ?? null, model: null, provider: null, used: 0, window: 0, pct: 0, prompt: 0, completion: 0, exact: true, live: false,
        doing: row?.state === "running" ? "working" : null, step, calls: 0, spent: 0, tools,
      });
      continue;
    }
    // What the agent holds is its latest call, so the number follows what is happening now. The window is the steady part: the smallest among the models it has been on,
    // because a rotation that lands on a 1M model and then a 131K one must not swing the denominator under a number that only grew by a few tokens.
    const used = note.prompt + note.completion;
    const window = Math.min(note.window, usage.floor?.[id] ?? note.window);
    const models = usage.models?.[id] ?? [];
    const live = note.live === true;
    agents.push({
      id, name: nameOf(id), state: row?.state ?? null,
      model: note.model, provider: note.provider,
      used, window, pct: percentOf(used, window),
      prompt: note.prompt, completion: note.completion, exact: note.exact && !note.live, live,
      doing: live ? (note.completion === 0 ? "waiting" : "writing") : row?.state === "running" ? "working" : null, step,
      calls: models.reduce((n, m) => n + m.calls, 0) || note.calls,
      spent: models.reduce((n, m) => n + m.prompt + m.completion, 0),
      tools,
    });
  }
  const inflight = agents.reduce((n, a) => n + (a.live ? a.used : 0), 0);
  return {
    agents,
    used: agents.reduce((n, a) => n + a.used, 0),
    window: agents.reduce((n, a) => n + a.window, 0),
    worst: Math.max(...agents.map((a) => a.pct)),
    spent: usage.tokens + inflight,
    calls: usage.calls,
    live: agents.some((a) => a.live),
    exact: agents.every((a) => a.exact),
    working: run.agents.filter((a) => a.state === "running").length,
  };
}
