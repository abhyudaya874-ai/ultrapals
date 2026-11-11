import type { ExamCard } from "@/lib/pals/card";
import type { Bracket } from "@/lib/arena/bracket";
import type { ArenaFinal, ContenderInfo, Facts, MatchResult, Mode, Outcome, Score } from "@/lib/arena/types";
import type { ChartSpec } from "@/lib/charts/spec";
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
  /** One model call finished: how many tokens it took and how much the model can hold. `exact` is true when the provider counted them. */
  | { kind: "usage"; agent: string; prompt: number; completion: number; window: number; model: string; provider: string; exact: boolean }
  | { kind: "term"; agent: string; id: string; command: string; state: RunState; out?: string; exit?: number; ms?: number }
  /** A file written (`patch` is the green/red diff against the old text) or read (`mode: "read"`, `patch` are numbered context rows). `preview` is the new text, capped. */
  | { kind: "file"; agent: string; id: string; path: string; created: boolean; adds: number; removes: number; preview: string; patch?: DiffLine[]; cut?: number; mode?: "write" | "read" }
  /** A chart UltraPal chose for a workspace table. `spec.data` is the table's own rows; `note` says when the chosen type did not fit and another was drawn. */
  | { kind: "chart"; agent: string; id: string; spec: ChartSpec; note?: string; source?: string }
  /** UltraPals Battle or Loop begins. `contenders` are the panels (in a loop, the rounds already planned; an adaptive loop adds them as it goes). */
  | { kind: "arena"; mode: Mode; plan: "auto" | "ai" | "manual"; scenario: string; question: string; max: number; adaptive: boolean; contenders: ContenderInfo[]; bracket?: Bracket }
  /** One event from inside one contender's own run (its agents, browser, terminal, files, answer). */
  | { kind: "contender"; id: string; e: CEvent }
  | { kind: "contender_add"; info: ContenderInfo }
  | { kind: "contender_done"; id: string; outcome: Outcome | null; facts: Facts; ok: boolean }
  | { kind: "arena_phase"; phase: "running" | "judging" | "writing" | "done"; note?: string }
  | { kind: "arena_scores"; scores: Score[]; winner: string; judge: string | null; why?: string; round?: number }
  /** A knockout match was decided (battle only). */
  | { kind: "arena_match"; match: MatchResult }
  | { kind: "arena_final"; final: ArenaFinal }
  /** Ask the UI to open an app artifact (newsroom, dashboard, timeline, proctor) as a tab. */
  | { kind: "open"; artifact: string; title: string }
  | { kind: "visit"; agent: string; id: string; action: "search" | "read"; label: string; url?: string; title?: string; via?: "tavily" | "exa" | "fetch" | "browser" | "terminal"; state: RunState; count?: number }
  | { kind: "ladder"; agent: string; card: ExamCard }
  | { kind: "situation"; agent: string; card: SituationCard }
  | { kind: "sources"; sources: Source[] }
  | { kind: "workspace"; liveViewUrl: string }
  | { kind: "page"; url: string; title: string }
  /** The agent cannot go on without the person (a CAPTCHA, a sign-in): the live browser is theirs until they say to continue. */
  | { kind: "handoff"; agent: string; reason: string; need: "captcha" | "login" | "verification" | "asked"; url: string }
  | { kind: "answer"; delta: string }
  | { kind: "done"; used: number[]; model: string; ms: number }
  | { kind: "error"; message: string };
