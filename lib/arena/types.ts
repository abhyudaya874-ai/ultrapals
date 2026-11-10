/** Shared shapes for UltraPals Battle and Loop. Plain data only: these travel in the event stream. */
export type Tool = "research" | "browser" | "terminal";
export type Mode = "battle" | "loop";
export const DIMENSIONS = ["evidence", "consistency", "calibration", "actionability", "fit"] as const;
export type Dim = (typeof DIMENSIONS)[number];

export interface ContenderInfo {
  id: string;
  /** "Skeptic", "Cost cutter" ... or "Round 2" in a loop. */
  name: string;
  persona: string;
  /** The prediction this contender was ASSIGNED to defend. It is a hypothesis to test, never a conclusion to fake. */
  stance: string;
  tool: Tool;
  /** The model it started on (it can fall back like any other call). */
  model?: string;
  round?: number;
  /** Loop only: the scenario variation this round ran, as "Name: what changed". */
  scenario?: string;
  /** The scenario's short name on its own ("Half the budget"). */
  scenarioName?: string;
  /** Loop only, from round 2: the best report so far, which this round was told to beat. */
  beat?: { headline: string; weakness?: string; score: number };
}

export interface Outcome {
  headline: string;
  prediction: string;
  /** 0..1 */
  confidence: number;
  recommendation: string;
  evidence: { claim: string; source?: string }[];
  risks: string[];
}

/** Things counted by code from what the contender actually did. A judge is told these as facts. */
export interface Facts {
  sources: number;
  cited: number;
  roles: string[];
  files: number;
  failed: boolean;
}

export interface Score {
  id: string;
  /** 0..10 from Facts only. */
  det: number;
  /** 0..10 mean of the blind judge's dimensions, null when the judge was unavailable. */
  llm: number | null;
  dims: Record<Dim, number> | null;
  /** 0..10: 0.4 det + 0.6 llm, or det alone when there is no judge. */
  total: number;
  weakness?: string;
}

export interface ArenaFinal {
  winner: string;
  /** The combined outcome, written from the winner plus the best verified points of the others. */
  text: string;
  provenance: { id: string; point: string }[];
  why: string;
  /** Model family that judged, null when no judge answered. */
  judge: string | null;
}

/** One knockout match as it was decided. `duel` is null for a bye, which is not a fight. */
export interface MatchResult {
  id: string;
  label: string;
  round: number;
  a: string | null;
  b: string | null;
  winner: string;
  loser: string | null;
  bye: boolean;
  duel: import("./duel").DuelResult | null;
  why: import("./duel").Why | null;
  /** True when a judge scored the two reports; false when the counted facts decided it. */
  judged: boolean;
  /** Why no judge scored them, when `judged` is false: a team has no report to judge, or no judge model answered. */
  unjudged?: "no_report" | "no_judge";
  judgeWhy?: string;
  /** Each fighter's health after the exchange (the winner then recovers a little before the next match). */
  hpAfter: { a: number; b: number } | null;
  hpNext: number | null;
}
