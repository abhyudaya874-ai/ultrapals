import type { ExamCard } from "@/lib/pals/card";
import type { DiffLine } from "./diff";
import type { SituationCard } from "@/lib/pals/situation";
import type { Source } from "@/lib/research/sources";

export type AgentRole = "main" | "research" | "browser" | "terminal" | "promise" | "rival" | "superpal" | "situation" | "sandbox";
export type RunState = "running" | "ok" | "error";

/** Text the user selected on screen and added to the chat (Devin-style "Add to chat"). */
export interface Attachment {
  id: string;
  text: string; // the selection, capped by the client
  path: string; // the route it came from, e.g. "/p?id=..."
}

/**
 * Everything the unified agent shows. One stream, one reducer (run.ts). `agent` is a role id like "browser-1";
 * the main agent is always "main". Append-only: a repeated id supersedes in place.
 */
export type CEvent =
  | { kind: "agent"; id: string; role: AgentRole; title: string; state: RunState; ms?: number; parent?: string }
  | { kind: "spawn"; parent: string; child: string; why: string; decision: "admitted" | "reused" | "denied"; detail?: string }
  | { kind: "message"; id: string; from: string; to: string; text: string }
  | { kind: "step"; agent: string; id: string; label: string; state: RunState; detail?: string; ms?: number }
  | { kind: "reasoning"; agent: string; delta: string }
  | { kind: "term"; agent: string; id: string; command: string; state: RunState; out?: string; exit?: number; ms?: number }
  /** A file written (`patch` is the green/red diff against the old text) or read (`mode: "read"`, `patch` are numbered context rows). `preview` is the new text, capped. */
  | { kind: "file"; agent: string; id: string; path: string; created: boolean; adds: number; removes: number; preview: string; patch?: DiffLine[]; cut?: number; mode?: "write" | "read" }
  /** Ask the UI to open an app artifact (newsroom, dashboard, timeline, proctor) as a tab. */
  | { kind: "open"; artifact: string; title: string }
  | { kind: "visit"; agent: string; id: string; action: "search" | "read"; label: string; url?: string; title?: string; via?: "tavily" | "exa" | "fetch" | "browser" | "terminal"; state: RunState; count?: number }
  | { kind: "ladder"; agent: string; card: ExamCard }
  | { kind: "situation"; agent: string; card: SituationCard }
  | { kind: "sources"; sources: Source[] }
  | { kind: "workspace"; liveViewUrl: string }
  | { kind: "page"; url: string; title: string }
  | { kind: "answer"; delta: string }
  | { kind: "done"; used: number[]; model: string; ms: number }
  | { kind: "error"; message: string };
