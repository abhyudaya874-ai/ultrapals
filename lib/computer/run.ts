import type { Source } from "@/lib/research/sources";
import type { AgentRole, Attachment, CEvent, RunState } from "./events";

export interface Step {
  id: string;
  label: string;
  state: RunState;
  detail?: string;
  ms?: number;
}
export interface TermBlock {
  id: string;
  command: string;
  state: RunState;
  out: string;
  exit?: number;
  ms?: number;
}
export interface FileEdit {
  id: string;
  path: string;
  created: boolean;
  adds: number;
  removes: number;
  preview: string;
}
export interface AgentRow {
  id: string;
  role: AgentRole;
  title: string;
  state: RunState;
  ms?: number;
  steps: Step[];
  reasoning: string;
  terms: TermBlock[];
  files: FileEdit[];
}
export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
}
export type TimelineItem = { t: "agent"; id: string } | { t: "message"; id: string };

/** One user request and everything the agents did for it. Built only from CEvents. */
export interface Run {
  id: string;
  prompt: string;
  attachments: Attachment[];
  agents: AgentRow[];
  messages: Message[];
  timeline: TimelineItem[];
  sources: Source[];
  answer: string;
  used: number[];
  status: "running" | "done" | "error";
  error?: string;
  model?: string;
  ms?: number;
  liveViewUrl?: string;
  page?: { url: string; title: string };
}

export const newRun = (id: string, prompt: string, attachments: Attachment[] = []): Run => ({
  id, prompt, attachments, agents: [], messages: [], timeline: [], sources: [], answer: "", used: [], status: "running",
});

const OUT_CAP = 20_000; // the UI keeps the tail of a terminal block; the model gets its own, smaller cap

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
};

const blank = (id: string, role: AgentRole = "main"): AgentRow => ({ id, role, title: id, state: "running", steps: [], reasoning: "", terms: [], files: [] });

function onAgent(r: Run, id: string, f: (a: AgentRow) => AgentRow): Run {
  const cur = r.agents.find((a) => a.id === id);
  const next = f(cur ?? blank(id, id.split("-")[0] as AgentRole));
  return { ...r, agents: upsert(r.agents, next), timeline: cur || r.timeline.some((t) => t.t === "agent" && t.id === id) ? r.timeline : [...r.timeline, { t: "agent", id }] };
}

/** Pure reducer. Events for an agent that has not announced itself still land (a blank row is created), so ordering bugs never drop work. */
export function applyCEvent(r: Run, e: CEvent): Run {
  switch (e.kind) {
    case "agent":
      return onAgent(r, e.id, (a) => ({ ...a, role: e.role, title: e.title, state: e.state, ms: e.ms ?? a.ms }));
    case "message": {
      const seen = r.messages.some((m) => m.id === e.id);
      return { ...r, messages: upsert(r.messages, { id: e.id, from: e.from, to: e.to, text: e.text }), timeline: seen ? r.timeline : [...r.timeline, { t: "message", id: e.id }] };
    }
    case "step":
      return onAgent(r, e.agent, (a) => ({ ...a, steps: upsert(a.steps, { id: e.id, label: e.label, state: e.state, detail: e.detail, ms: e.ms }) }));
    case "reasoning":
      return onAgent(r, e.agent, (a) => ({ ...a, reasoning: a.reasoning + e.delta }));
    case "term":
      return onAgent(r, e.agent, (a) => {
        const prev = a.terms.find((t) => t.id === e.id);
        const out = ((prev?.out ?? "") + (e.out ?? "")).slice(-OUT_CAP);
        return { ...a, terms: upsert(a.terms, { id: e.id, command: e.command, state: e.state, out, exit: e.exit ?? prev?.exit, ms: e.ms ?? prev?.ms }) };
      });
    case "file":
      return onAgent(r, e.agent, (a) => ({ ...a, files: upsert(a.files, { id: e.id, path: e.path, created: e.created, adds: e.adds, removes: e.removes, preview: e.preview }) }));
    case "sources":
      return { ...r, sources: e.sources };
    case "workspace":
      return { ...r, liveViewUrl: e.liveViewUrl };
    case "page":
      return { ...r, page: { url: e.url, title: e.title } };
    case "answer":
      return { ...r, answer: r.answer + e.delta };
    case "done":
      return { ...r, status: "done", used: e.used, model: e.model, ms: e.ms };
    case "error":
      return { ...r, status: "error", error: e.message };
  }
}

/** Pure. Splits the `data: <json>` SSE body into events plus the unfinished tail. Junk lines are skipped. */
export function parseCStream(buffer: string): { events: CEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((p) => {
    const data = p.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    try {
      const j = JSON.parse(data) as CEvent;
      return typeof j?.kind === "string" ? [j] : [];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

/** Pure. Rows for the thread's "Process" disclosure: subagents only, the main agent is the narrator. */
export const subagents = (r: Run): AgentRow[] => r.agents.filter((a) => a.role !== "main");
