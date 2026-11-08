import type { ResearchEvent } from "./run";
import type { Source } from "./sources";

export interface Step {
  id: string;
  label: string;
  state: "running" | "ok" | "error";
  detail?: string;
  ms?: number;
}

/** One question and everything the thread shows for it. Built only from ResearchEvents. */
export interface Turn {
  id: string;
  question: string;
  steps: Step[];
  reasoning: string;
  answer: string;
  sources: Source[];
  used: number[];
  status: "running" | "done" | "error";
  error?: string;
  model?: string;
  ms?: number;
}

export const newTurn = (id: string, question: string): Turn => ({ id, question, steps: [], reasoning: "", answer: "", sources: [], used: [], status: "running" });

/** Pure reducer. A repeated step id supersedes the earlier row in place (append-only rule, same as the trace). */
export function applyEvent(t: Turn, e: ResearchEvent): Turn {
  switch (e.kind) {
    case "step": {
      const { kind: _k, ...step } = e;
      const i = t.steps.findIndex((s) => s.id === step.id);
      return { ...t, steps: i < 0 ? [...t.steps, step] : t.steps.map((s, j) => (j === i ? step : s)) };
    }
    case "sources":
      return { ...t, sources: e.sources };
    case "reasoning":
      return { ...t, reasoning: t.reasoning + e.delta };
    case "answer":
      return { ...t, answer: t.answer + e.delta };
    case "done":
      return { ...t, status: "done", used: e.used, model: `${e.model.split("/").pop()} · ${e.provider}`, ms: e.ms };
    case "error":
      return { ...t, status: "error", error: e.message };
  }
}

/** Pure. Splits the `data: <json>` SSE body into events plus the unfinished tail. Junk lines are skipped. */
export function parseResearchStream(buffer: string): { events: ResearchEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((p) => {
    const data = p.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    try {
      const j = JSON.parse(data) as ResearchEvent;
      return typeof j?.kind === "string" ? [j] : [];
    } catch {
      return [];
    }
  });
  return { events, rest };
}
