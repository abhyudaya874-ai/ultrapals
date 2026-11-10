import { z } from "zod";

/** Canonical node kinds. Display names (UltraPal, SuperPals, ResearchPal ...) live in lib/computer/pals.ts. */
export const Kind = z.enum(["root", "pal", "research", "browser", "terminal", "observe"]);
export type Kind = z.infer<typeof Kind>;
/** script = deterministic executor, 0 LLM calls. loop = an LLM-driven worker that spends calls. */
export const Mode = z.enum(["script", "loop"]);
export type Mode = z.infer<typeof Mode>;
export const Tool = z.enum(["tavily", "exa", "fetch", "render", "term", "llm"]);
export type Tool = z.infer<typeof Tool>;

/** No PayPal, database or money tool exists in this enum, so no node at any depth can hold one. */
export interface Caps {
  spawn: readonly Kind[];
  tools: readonly Tool[];
  maxCalls: number;
  maxMs: number;
}

/** Who may spawn whom. The only source of spawn rights. */
export const SPAWNS: Record<Kind, readonly Kind[]> = {
  root: ["pal"],
  pal: ["research", "browser", "terminal", "observe"],
  browser: ["research"],
  terminal: ["research", "observe"],
  research: [],
  observe: [],
};

export const POLICY = { maxDepth: 4, maxNodes: 48, maxFanout: 12, maxLoopNodes: 8, maxLoopLive: 3, askShare: 0.5 } as const;

export const SpawnRequest = z.object({
  kind: Kind,
  mode: Mode,
  task: z.string().max(300),
  why: z.string().max(160),
  input: z.record(z.string(), z.unknown()),
  ask: z.object({ calls: z.number().int().min(0).max(12), ms: z.number().int().min(1000).max(120_000) }),
  expects: z.enum(["observations", "cases", "sources", "modespec", "summary"]),
});
export type SpawnRequest = z.infer<typeof SpawnRequest>;

export type NodeState = "live" | "done" | "failed";
export interface TreeNode {
  id: string;
  parent: string | null;
  kind: Kind;
  mode: Mode;
  key: string;
  depth: number;
  caps: Caps;
  callsLeft: number;
  deadlineMs: number;
  state: NodeState;
}
export interface TreeView {
  nodes: readonly TreeNode[];
}

export type Denial = "no_reason" | "unknown_parent" | "privilege" | "depth" | "fanout" | "nodes" | "loop_cap" | "budget" | "deadline" | "repeat";
export type Decision = { ok: true; reuse?: string } | { ok: false; why: Denial };

/** Pure. A child can never gain a tool, a spawn kind or budget its parent lacks: every field is an intersection or a minimum. */
export function attenuate(parent: Caps, want: Partial<Caps>): Caps {
  const inter = <T>(a: readonly T[], b: readonly T[] | undefined): T[] => (b ? a.filter((x) => b.includes(x)) : [...a]);
  return {
    spawn: inter(parent.spawn, want.spawn),
    tools: inter(parent.tools, want.tools),
    maxCalls: Math.min(parent.maxCalls, want.maxCalls ?? parent.maxCalls),
    maxMs: Math.min(parent.maxMs, want.maxMs ?? parent.maxMs),
  };
}

/** Pure. Order-independent identity of a job: the same kind, mode, task and input is the same work. */
export function jobKey(req: Pick<SpawnRequest, "kind" | "mode" | "task" | "input">): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)])) : v;
  return JSON.stringify(canon({ k: req.kind, m: req.mode, t: req.task.trim().toLowerCase(), i: req.input }));
}
