import { subagents, type ArenaState, type ContenderState } from "@/lib/computer/run";
import { roundDiff, type RoundDiff } from "./diff";
import { hostOfSource, type Entry } from "./explain";

/** Pure. A scored contender as a report entry (null until it has been scored). */
export function toEntry(c: ContenderState): Entry | null {
  return c.score ? { id: c.info.id, name: c.info.name, outcome: c.outcome ?? null, facts: c.facts ?? null, score: c.score, sources: c.run.sources.map((s) => ({ n: s.n, host: s.host, title: s.title })) } : null;
}

/** Pure. Every scored contender, in the order they were added. */
export const entriesOf = (a: ArenaState): Entry[] => a.contenders.flatMap((c) => { const e = toEntry(c); return e ? [e] : []; });

export interface RoundView {
  round: number;
  c: ContenderState;
  entry: Entry | null;
  /** What changed from the round before (null for the first round, or when this one is not scored yet). */
  diff: RoundDiff | null;
  /** The best round so far; once the loop is done, the winner. */
  best: boolean;
  /** The round just before this one that was scored. */
  prev: ContenderState | null;
}

/** Pure. A loop as rounds in order, each with what changed from the round before it. */
export function roundViews(a: ArenaState): RoundView[] {
  const cs = [...a.contenders].sort((x, y) => (x.info.round ?? 0) - (y.info.round ?? 0));
  const bestId = a.winner ?? "";
  let prev: ContenderState | null = null;
  return cs.map((c, i): RoundView => {
    const entry = toEntry(c);
    const before = prev ? toEntry(prev) : null;
    const diff = entry && i > 0 ? roundDiff(before, entry, { scenarioFrom: prev?.info.scenarioName ?? null, scenarioTo: c.info.scenarioName ?? c.info.name, weakness: c.info.beat?.weakness }) : null;
    const view: RoundView = { round: c.info.round ?? i + 1, c, entry, diff, best: c.info.id === bestId, prev };
    if (entry) prev = c;
    return view;
  });
}

/** Pure. How far along a contest is, for a one-line summary: contenders finished out of all, and what it is doing now. */
export function progressOf(a: ArenaState): { done: number; total: number; text: string } {
  const done = a.contenders.filter((c) => c.state === "ok" || c.state === "error").length;
  const total = a.adaptive ? Math.max(a.max, a.contenders.length) : a.contenders.length;
  const unit = a.mode === "battle" ? "teams" : "rounds";
  if (a.phase === "done") return { done, total, text: a.final ? "Finished" : "Finished without a result" };
  if (a.phase === "writing") return { done, total, text: "Writing the combined outcome" };
  if (a.phase === "judging") return { done, total, text: a.mode === "battle" ? `Knockout: ${a.matches.filter((m) => !m.bye).length} match${a.matches.filter((m) => !m.bye).length === 1 ? "" : "es"} played` : "Judging" };
  return { done, total, text: `${done} of ${total} ${unit} finished` };
}

/** Pure. A contender's id -> its place in the knockout once it is over: "Champion", "Runner-up", "Third", "Out in the semi-final". Null while it is still in. */
export function placeOf(a: ArenaState, id: string): string | null {
  if (!a.final) return null;
  if (a.final.winner === id) return "Champion";
  const third = a.matches.find((m) => m.label === "Third place");
  if (third?.winner === id) return "Third";
  if (third?.loser === id) return "Fourth";
  const lost = a.matches.find((m) => m.loser === id);
  if (!lost) return null;
  return lost.label === "Final" ? "Runner-up" : `Out in the ${lost.label.toLowerCase()}`;
}

/** Pure. What a contender is doing, in a few words: the step that is running now, else where it stands. */
export function statusText(c: ContenderState): string {
  if (c.state === "pending") return "Waiting for a turn";
  if (c.state === "error") return "Stopped early";
  if (c.state === "ok") return c.score ? `Scored ${c.score.total} out of 10` : "Finished";
  const now = subagents(c.run).flatMap((a) => a.steps).reverse().find((s) => s.state === "running");
  return now?.label ?? (c.run.answer ? "Writing its report" : "Working");
}

export interface FinalPart { title: string | null; lines: string[] }
/** Pure. The combined outcome split under its headings (Best outcome, Why it won, ...). Text with no headings is one part with no title. */
export function splitFinal(text: string): FinalPart[] {
  const parts: FinalPart[] = [];
  let cur: FinalPart | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^(BEST OUTCOME|WHY IT WON|WHAT THE OTHERS GOT RIGHT|WATCH OUT FOR)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      cur = { title: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(), lines: m[2] ? [m[2]] : [] };
      parts.push(cur);
    } else if (line) {
      if (!cur) { cur = { title: null, lines: [] }; parts.push(cur); }
      cur.lines.push(line);
    }
  }
  return parts;
}

export interface EvidenceLine { claim: string; source: string | null; host: string | null; n: number | null }
/** Pure. What a contender gave as evidence: each claim, the site it named, and (when that site is one it found) the number of the source, so a card can show the page. */
export function evidenceLines(c: ContenderState): EvidenceLine[] {
  const sources = c.run.sources.map((s) => ({ n: s.n, host: s.host }));
  return (c.outcome?.evidence ?? []).map((e) => {
    const host = hostOfSource(e.source, sources);
    return { claim: e.claim, source: e.source ?? null, host, n: host ? (sources.find((s) => s.host === host)?.n ?? null) : null };
  });
}

export interface PathStep { label: string; opponent: string; hp: number | null; ko: boolean }
/** Pure. The matches a contender won, in order, with who it beat and how much health it had left. */
export function pathOf(a: ArenaState, id: string): PathStep[] {
  const name = (x: string | null): string => a.contenders.find((c) => c.info.id === x)?.info.name ?? "";
  return a.matches
    .filter((m) => !m.bye && m.winner === id)
    .sort((x, y) => x.round - y.round)
    .map((m) => ({ label: m.label, opponent: name(m.loser), hp: m.hpAfter ? m.hpAfter[m.a === id ? "a" : "b"] : null, ko: !!m.duel?.ko }));
}
