import type { ExamCard } from "@/lib/pals/card";
import type { SituationCard } from "@/lib/pals/situation";
import type { Source } from "@/lib/research/sources";
import type { Bracket } from "@/lib/arena/bracket";
import type { ArenaFinal, ContenderInfo, Facts, MatchResult, Mode, Outcome, Score } from "@/lib/arena/types";
import type { ChartSpec } from "@/lib/charts/spec";
import type { DiffLine } from "./diff";
import type { AgentRole, Attachment, CEvent, RunState } from "./events";
import { hostOfUrl, type Visit } from "./visits";

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
  patch?: DiffLine[];
  cut?: number;
  mode?: "write" | "read";
}
export interface ChartItem {
  id: string;
  spec: ChartSpec;
  note?: string;
  source?: string;
}
export interface ContenderState {
  info: ContenderInfo;
  /** Its own run: agents, steps, terminal, files, sources, streamed answer. */
  run: Run;
  state: "pending" | "running" | "ok" | "error";
  outcome?: Outcome | null;
  facts?: Facts;
  score?: Score;
}
export interface ArenaState {
  mode: Mode;
  plan: "auto" | "ai" | "manual";
  scenario: string;
  question: string;
  max: number;
  adaptive: boolean;
  phase: "running" | "judging" | "writing" | "done";
  phaseNote?: string;
  contenders: ContenderState[];
  winner?: string;
  judge?: string | null;
  judgeWhy?: string;
  /** Loop: the best total after each round. */
  history: { round: number; best: number }[];
  /** Battle: the knockout bracket, the matches decided so far, and everyone's health now. */
  bracket?: Bracket;
  matches: MatchResult[];
  hp: Record<string, number>;
  final?: ArenaFinal;
}
export interface AgentRow {
  id: string;
  role: AgentRole;
  title: string;
  state: RunState;
  ms?: number;
  parent?: string;
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
export interface SpawnNote {
  parent: string;
  child: string;
  why: string;
  decision: "admitted" | "reused" | "denied";
  detail?: string;
}
export type TimelineItem = { t: "agent"; id: string } | { t: "message"; id: string };

/** One user request and everything the agents did for it. Built only from CEvents. */
export interface Run {
  id: string;
  prompt: string;
  attachments: Attachment[];
  /** Thumbnails of the pictures sent with the prompt (browser only; the server never stores them). */
  images?: { id: string; name: string; url: string }[];
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
  exam?: ExamCard;
  situation?: SituationCard;
  /** Charts UltraPal drew from workspace tables. */
  charts?: ChartItem[];
  /** Set when this run was a Battle or a Loop. */
  arena?: ArenaState;
  /** Set when the browser agent stopped for the person (a CAPTCHA, a sign-in): what they have to do and where. */
  handoff?: { reason: string; need: "captcha" | "login" | "verification" | "asked"; url: string; agent: string };
  /** Every search made and page read by any agent, in order. Perplexity-style "sites searched". */
  visits: Visit[];
  spawns: SpawnNote[];
}

export const newRun = (id: string, prompt: string, attachments: Attachment[] = [], images: { id: string; name: string; url: string }[] = []): Run => ({
  id, prompt, attachments, ...(images.length ? { images } : {}), agents: [], messages: [], timeline: [], sources: [], answer: "", used: [], status: "running", visits: [], spawns: [],
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
      return onAgent(r, e.id, (a) => ({ ...a, role: e.role, title: e.title, state: e.state, ms: e.ms ?? a.ms, parent: e.parent ?? a.parent }));
    case "spawn":
      return { ...r, spawns: [...r.spawns, { parent: e.parent, child: e.child, why: e.why, decision: e.decision, detail: e.detail }] };
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
      return onAgent(r, e.agent, (a) => ({ ...a, files: upsert(a.files, { id: e.id, path: e.path, created: e.created, adds: e.adds, removes: e.removes, preview: e.preview, patch: e.patch, cut: e.cut, mode: e.mode }) }));
    case "visit": {
      const { kind: _k, ...v } = e;
      // one entry per id; the same page (canonical URL) read by two agents is one visit
      return { ...r, visits: upsert(r.visits, v).slice(-300) };
    }
    case "chart":
      return { ...r, charts: upsert(r.charts ?? [], { id: e.id, spec: e.spec, note: e.note, source: e.source }) };
    case "arena":
      return { ...r, arena: { mode: e.mode, plan: e.plan, scenario: e.scenario, question: e.question, max: e.max, adaptive: e.adaptive, phase: "running", history: [], matches: [], hp: Object.fromEntries(e.contenders.map((c) => [c.id, 100])), ...(e.bracket ? { bracket: e.bracket } : {}), contenders: e.contenders.map((info) => ({ info, run: newRun(info.id, info.scenario ?? e.scenario), state: "pending" as const })) } };
    case "contender": {
      if (!r.arena) return r;
      return { ...r, arena: { ...r.arena, contenders: r.arena.contenders.map((c) => (c.info.id === e.id ? { ...c, run: applyCEvent(c.run, e.e), state: c.state === "pending" ? ("running" as const) : c.state } : c)) } };
    }
    case "contender_add":
      // a new contender, or (a planned loop round) what an existing one has learned about what to beat
      return r.arena ? { ...r, arena: { ...r.arena, contenders: r.arena.contenders.some((c) => c.info.id === e.info.id) ? r.arena.contenders.map((c) => (c.info.id === e.info.id ? { ...c, info: e.info } : c)) : [...r.arena.contenders, { info: e.info, run: newRun(e.info.id, e.info.scenario ?? r.arena.scenario), state: "running" as const }] } } : r;
    case "contender_done":
      return r.arena ? { ...r, arena: { ...r.arena, contenders: r.arena.contenders.map((c) => (c.info.id === e.id ? { ...c, state: e.ok ? ("ok" as const) : ("error" as const), outcome: e.outcome, facts: e.facts } : c)) } } : r;
    case "arena_phase":
      // the last note stays when the contest ends: a loop's reason for stopping is part of its result
      return r.arena ? { ...r, arena: { ...r.arena, phase: e.phase, phaseNote: e.note ?? (e.phase === "done" ? r.arena.phaseNote : undefined) } } : r;
    case "arena_scores":
      return r.arena ? { ...r, arena: { ...r.arena, winner: e.winner, judge: e.judge, judgeWhy: e.why, contenders: r.arena.contenders.map((c) => ({ ...c, score: e.scores.find((s) => s.id === c.info.id) ?? c.score })), history: e.round ? [...r.arena.history.filter((h) => h.round !== e.round), { round: e.round, best: e.scores[0]?.total ?? 0 }] : r.arena.history } } : r;
    case "arena_match":
      return r.arena ? { ...r, arena: { ...r.arena, matches: [...r.arena.matches.filter((m) => m.id !== e.match.id), e.match], hp: { ...r.arena.hp, ...(e.match.duel && e.match.a && e.match.b && e.match.hpAfter ? { [e.match.a]: e.match.hpAfter.a, [e.match.b]: e.match.hpAfter.b } : {}), ...(e.match.hpNext !== null ? { [e.match.winner]: e.match.hpNext } : {}) } } } : r;
    case "arena_final":
      return r.arena ? { ...r, arena: { ...r.arena, final: e.final, winner: e.final.winner } } : r;
    case "ladder":
      return { ...r, exam: e.card };
    case "situation":
      return { ...r, situation: e.card };
    case "sources":
      return { ...r, sources: e.sources };
    case "workspace":
      return { ...r, liveViewUrl: e.liveViewUrl };
    case "handoff":
      return { ...r, handoff: { reason: e.reason, need: e.need, url: e.url, agent: e.agent } };
    case "page": {
      const host = hostOfUrl(e.url);
      const seen = r.visits.some((v) => v.action === "read" && v.url === e.url);
      return { ...r, page: { url: e.url, title: e.title }, visits: host && !seen && !/^https?:\/\/(localhost|127\.)/.test(e.url) ? [...r.visits, { id: `read:${e.url}`, agent: "browser", action: "read" as const, label: host, url: e.url, title: e.title, via: "browser" as const, state: "ok" as const }].slice(-300) : r.visits };
    }
    case "open":
      return r; // the provider opens the tab as the event streams by; the run itself has nothing to keep
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
