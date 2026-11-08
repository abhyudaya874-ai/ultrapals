import type { SubagentId, SubagentState, TraceEvent } from "@/lib/agent/types";

type Of<K extends TraceEvent["kind"]> = Extract<TraceEvent, { kind: K }>;
export type StepItem = Exclude<TraceEvent, { kind: "subagent" | "verdict" | "done" }>;

export interface StepGroup {
  id: string; // the subagent event id, or "run" for events that arrive before any subagent row
  agent: SubagentId | null;
  title: string;
  state: SubagentState;
  ms?: number;
  items: StepItem[];
}

export interface TraceView {
  groups: StepGroup[];
  verdict: Of<"verdict"> | null;
  done: Of<"done"> | null;
  explanation: string | null; // the explainer's thought (id "explain-N"); null until it arrives
  diff: Of<"diff"> | null; // the streamed source of decide()
}

/**
 * TraceEvent[] (already upserted: a settled event replaced its running twin IN PLACE, so list order = first-seen order)
 * -> what the thread renders. Rule: a `subagent` row opens a group; everything after it belongs to it until the next one.
 * Known limit: the explainer / nudger / archivist run in parallel, so their tool rows attach to whichever row came last.
 */
export function groupTrace(events: TraceEvent[]): TraceView {
  const view: TraceView = { groups: [], verdict: null, done: null, explanation: null, diff: null };
  for (const e of events) {
    switch (e.kind) {
      case "subagent":
        view.groups.push({ id: e.id, agent: e.agent, title: e.title, state: e.state, ms: e.ms, items: [] });
        break;
      case "verdict":
        view.verdict = e;
        break;
      case "done":
        view.done = e;
        break;
      default: {
        if (e.kind === "thought" && e.id.startsWith("explain-")) {
          view.explanation = e.text; // it is the ANSWER, not a step: lifted out, never listed inside a group
          break;
        }
        if (e.kind === "diff") view.diff = e;
        let g = view.groups[view.groups.length - 1];
        if (!g) {
          g = { id: "run", agent: null, title: "Run", state: "running", items: [] };
          view.groups.push(g);
        }
        g.items.push(e);
      }
    }
  }
  return view;
}

/** Exhaustive on purpose: an unknown tool is shown by its real name, never a guessed sentence. */
const TOOL_VERB: Record<string, string> = {
  "paypal.getOrder": "Checked the PayPal order",
  "paypal.captureOrder": "Captured the payment",
  "channel3.search": "Searched Channel3",
  "kernel.observe": "Opened the page in KERNEL",
  "elastic.precedent": "Looked up precedent",
  "elastic.index": "Indexed the verdict",
  "zapier.nudge": "Sent a friendly nudge",
};
export const toolVerb = (name: string): string => TOOL_VERB[name] ?? `Ran ${name}`;

/** One line for a collapsed step group: "Checked the PayPal order · Searched Channel3". */
export function stepSummary(g: StepGroup): string {
  const names: string[] = [];
  for (const it of g.items) if (it.kind === "tool" && !names.includes(it.name)) names.push(it.name);
  return names.length ? names.map(toolVerb).join(" · ") : g.title;
}

/** A degraded vendor is a RED row (UI-SPEC). */
export const isDegraded = (g: StepGroup): boolean => g.state === "error" || g.items.some((i) => i.kind === "tool" && i.state === "error");

/** "7 agents · 5 tool calls" for the process header. */
export function processCounts(groups: StepGroup[]): string {
  const agents = groups.filter((g) => g.agent !== null).length;
  const tools = groups.reduce((n, g) => n + g.items.filter((i) => i.kind === "tool").length, 0);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `${plural(agents, "agent")} · ${plural(tools, "tool call")}`;
}

/** History view (page reload, no live trace): duration of the latest attempt from the persisted event log. */
export function durationFromLog(log: { attempt: number; createdAtIso: string }[]): number | null {
  if (log.length === 0) return null;
  const last = Math.max(...log.map((l) => l.attempt));
  const t = log.filter((l) => l.attempt === last).map((l) => Date.parse(l.createdAtIso));
  return Math.max(...t) - Math.min(...t);
}
