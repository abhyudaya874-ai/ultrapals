import { usedSources } from "@/lib/research/citations";
import { familyOf } from "@/lib/pals/family";
import { writeArtifact } from "@/lib/computer/artifacts";
import type { Deps } from "@/lib/computer/ctx";
import type { CEvent } from "@/lib/computer/events";
import { runMain } from "@/lib/computer/main-agent";
import { isFinding } from "@/lib/computer/main-actions";
import { benchedLong, callModel, callModelHedged, orderModels, type ModelResult } from "@/lib/computer/model";
import { modelDepsFor, roundsFor, type ModelChoice } from "@/lib/computer/models";
import { PAL_NAMES } from "@/lib/computer/pals";
import { applyCEvent, newRun, subagents, type Run } from "@/lib/computer/run";
import { pushHistory, type Session } from "@/lib/computer/session";
import { mergeStreams } from "@/lib/swarm/tree/merge";
import type { Entry } from "./explain";
import { LOOP_GOOD_ENOUGH, briefMessages, contenderPrompt, fallbackOutcome, loopStop, nextLens, outcomeMessages, parseBrief, parseOutcome, parseProvenance, parseScenario, scenarioMessages, synthMessages, type Brief } from "./frame";
import { buildBracket, nextMatch, resolve, standings, type Result } from "./bracket";
import { MAX_HP, duel, recover, whyResult, type Fighter } from "./duel";
import { detScore, judgeMessages, judgeOrder, labelMap, meanScores, parseJudge, scoreAll, type Judged, type Judgement } from "./judge";
import { PLAN_LABEL, planMessages, planFromDraft, planProblems, type Plan, type PlanMode, type Slot } from "./plan";
import { PERSONAS } from "./personas";
import { fallbackFinalText, reportMarkdown, scoresCsv } from "./report";
import type { ArenaFinal, ContenderInfo, Facts, MatchResult, Outcome, Score } from "./types";

export const PARALLEL = 3;
export const CONTENDER_MS = 170_000;
/** After this long a contender is told to write its report now, so it is not cut off at CONTENDER_MS with nothing to show. */
export const CONTENDER_SOFT_MS = 100_000;
/**
 * After this long the Pal still at work for a contender is stopped and no new work is handed out, so the report has the last 50 s. Seen live
 * 2026-11-12: a team that delegated just before CONTENDER_SOFT_MS got its research back at 152 s, and the planner's answer was cut off at 170 s.
 */
export const CONTENDER_WORK_MS = 120_000;
/** Reading a team's report into an outcome gets its own time, so a team that used all of CONTENDER_MS still has its report read. */
export const WRITE_UP_MS = 30_000;
export const START_NO_NEW_AFTER_MS = 400_000;
export const CONTENDER_ROUNDS_CAP = 5;

export interface ArenaDeps {
  /** A fresh conversation for one contender (its own browser and terminal when it needs them). */
  open: () => Session;
  /** Ends it and deletes its cloud computer, which bills while alive. */
  close: (s: Session) => Promise<void>;
  now: () => number;
}
export interface ArenaInput {
  prompt: string;
  /** battle or loop, with the slots already decided (by Autopilot, by a model the person approved, or by the person). */
  plan: Plan;
  planMode: PlanMode;
  choice: ModelChoice;
}

/** Runs a generator to its end, discarding its events. Used for model calls whose reasoning the contest does not show. */
async function drain<T>(g: AsyncGenerator<CEvent, T>): Promise<T> {
  for (;;) {
    const n = await g.next();
    if (n.done) return n.value;
  }
}

/**
 * Pure. One model family per contender where the roster allows. Past that, a model no team has yet (another provider's copy of the same model only
 * once every distinct model is used), and only then do teams share one. Seen live 2026-11-12: with Groq and OpenRouter out for the day, one model
 * per family left four teams on two models, while NVIDIA alone had four that answer.
 */
export function pinsFor(roster: readonly { provider: string; model: string }[], n: number): { provider: string; model: string }[] {
  const pool = roster.filter((m) => m.model !== "openrouter/free");
  const bare = (m: { model: string }) => m.model.replace(/:free$/i, "");
  const order: { provider: string; model: string }[] = [];
  const families = new Set<string>();
  for (const m of pool) if (!families.has(familyOf(m.model))) { families.add(familyOf(m.model)); order.push(m); }
  for (const m of pool) if (!order.includes(m) && !order.some((o) => bare(o) === bare(m))) order.push(m);
  for (const m of pool) if (!order.includes(m)) order.push(m);
  return Array.from({ length: n }, (_, i) => order[i % Math.max(1, order.length)] ?? roster[0]);
}

/**
 * Pure. What a team's Pals reported, as the team's report, for a team that stopped before writing one (its time ran out, or no model would plan).
 * Null when nothing they returned is a finding: a team that found nothing has no report, rather than a report that only says it failed.
 */
export function findingsReport(messages: readonly { from: string; to: string; text: string }[]): string | null {
  const found = messages.filter((m) => m.to === "main" && m.from !== "main" && isFinding(m.text)).map((m) => m.text.trim());
  if (!found.length) return null;
  return `${found.join("\n\n").slice(0, 4000)}\n\n(The team stopped before writing its own report; these are its findings as its Pals reported them.)`;
}

/** Pure. What was counted about a finished contender run. */
export function factsOf(run: Run, session: Pick<Session, "files">): Facts {
  const written = new Set<string>([...Object.keys(session.files).map((p) => `/workspace/${p}`), ...run.agents.flatMap((a) => a.files).filter((f) => f.mode !== "read").map((f) => f.path)]);
  return {
    sources: run.sources.length,
    cited: run.used.length,
    roles: [...new Set(subagents(run).map((a) => a.role))],
    files: written.size,
    failed: run.status !== "done" || run.answer.trim().length === 0,
  };
}

const infoFor = (i: number, s: Slot, kind: Plan["kind"], model?: string): ContenderInfo => {
  const p = PERSONAS.find((x) => x.id === s.persona) ?? PERSONAS[0];
  const base = { persona: p.blurb, stance: s.stance?.label ?? "Best-supported answer", tool: s.tool, ...(model ? { model } : {}) };
  const sc = s.scenario ? { scenario: `${s.scenario.name}: ${s.scenario.change}`, scenarioName: s.scenario.name } : {};
  return kind === "battle"
    ? { id: `c${i + 1}-${p.id}`, name: p.name, round: undefined, ...sc, ...base }
    : { id: `r${i + 1}-${p.id}`, name: `Round ${i + 1}: ${s.scenario?.name ?? p.name}`, round: i + 1, ...sc, ...base };
};

/**
 * UltraPals Battle and Loop. Several independent teams (each its own browser, terminal and research, on a different model, with a different
 * method and an assigned prediction) answer the same question. A blind judge scores them on counted facts plus five dimensions, the best is
 * chosen, and a final outcome is written from the winner plus the best verified points of the others. In a Loop the teams run one after
 * another, each on a different scenario, until the best answer is good enough or stops improving. Nothing here pays for anything or schedules anything.
 */
export async function* runArena(session: Session, input: ArenaInput, deps: Deps, a: ArenaDeps, signal?: AbortSignal): AsyncGenerator<CEvent> {
  const t0 = a.now();
  const { plan } = input;
  const kind = plan.kind;
  const problems = planProblems(plan);
  yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "running" };
  if (problems.length) {
    yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "error", ms: a.now() - t0 };
    yield { kind: "error", message: `The plan cannot run: ${problems.join("; ")}.` };
    return;
  }
  const brief: Brief = { question: plan.question, success: plan.success, horizon: plan.horizon };
  // one model family per team, but never a model that is benched for the day or gone: a team pinned to it would start by failing
  const usable = deps.model.models.filter((m) => !benchedLong(m, deps.model.now()));
  const pins = pinsFor(usable.length ? usable : deps.model.models, plan.slots.length);
  const adaptive = kind === "loop" && input.planMode === "auto";
  const label = kind === "battle" ? "Battle" : "Loop";
  const rounds = Math.min(roundsFor(input.choice), CONTENDER_ROUNDS_CAP);

  const outcomes = new Map<string, Outcome | null>();
  const factsBy = new Map<string, Facts>();
  const sourcesBy = new Map<string, Entry["sources"]>();
  const infos: ContenderInfo[] = [];
  const names: Record<string, string> = {};
  /** Words a report must not be able to use to tell the judge who wrote it. */
  const hideNames = [...PERSONAS.map((p) => p.name), ...PERSONAS.map((p) => p.id)];

  /** One contender, start to finish, in its own session. Events are passed up wrapped with its id. */
  const contender = (info: ContenderInfo, slot: Slot, i: number, best?: { headline: string; weakness?: string }) => async function* (): AsyncGenerator<CEvent, void> {
    const sess = a.open();
    sess.busy = true;
    const began = a.now();
    let run = newRun(info.id, plan.question);
    const timeout = AbortSignal.timeout(CONTENDER_MS);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const stopWork = AbortSignal.timeout(CONTENDER_WORK_MS);
    const persona = PERSONAS.find((p) => p.id === slot.persona) ?? PERSONAS[0];
    const pin = pins[i];
    const pinned = modelDepsFor(deps.model, { level: input.choice.level, pin: { provider: pin.provider as never, model: pin.model } });
    // A team that has to fall back (a rate limit, a bad minute) should not fall onto the same next model as every other team: each team's fallbacks start one place further along.
    const fallbacks = pinned.models[0]?.model === pin.model ? orderModels(pinned.models.slice(1), i, a.now(), new Map(), Math.max(1, (deps.model.spread ?? pinned.models.length) - 1)) : null;
    const cdeps: Deps = { ...deps, model: fallbacks ? { ...pinned, models: [pinned.models[0], ...fallbacks] } : pinned };
    const stance = slot.stance ? { text: slot.stance.text } : null;
    const prompt = contenderPrompt({ mode: kind, scenario: input.prompt, brief, persona, stance, tool: slot.tool, ...(slot.scenario ? { variation: slot.scenario } : {}), ...(best ? { best } : {}) });
    const wrap = (e: CEvent): CEvent => ({ kind: "contender", id: info.id, e });
    try {
      for await (const e of runMain(sess, { prompt, attachments: [], path: "/", pageContext: null, maxRounds: rounds, deny: ["promise", "automate"], hurry: () => a.now() - began > CONTENDER_SOFT_MS, stopWork }, cdeps, sig)) {
        run = applyCEvent(run, e);
        yield wrap(e);
      }
      if (run.status === "running") { const e: CEvent = { kind: "error", message: timeout.aborted ? "stopped after the time limit" : "the run ended early" }; run = applyCEvent(run, e); yield wrap(e); }
    } catch (err) {
      const e: CEvent = { kind: "error", message: err instanceof Error ? err.message : "the run crashed" };
      run = applyCEvent(run, e);
      yield wrap(e);
    }
    // No answer, but the team's Pals found things: those findings are its report, so the judge has something to read instead of "no report".
    if (!run.answer.trim()) {
      const found = findingsReport(run.messages);
      if (found) { const e: CEvent = { kind: "answer", delta: found }; run = applyCEvent(run, e); yield wrap(e); }
    }
    const facts = factsOf(run, sess);
    let outcome: Outcome | null = null;
    if (run.answer.trim()) {
      yield wrap({ kind: "step", agent: "main", id: "write-up", label: "Writing up the outcome", state: "running" });
      const writeUp = signal ? AbortSignal.any([signal, AbortSignal.timeout(WRITE_UP_MS)]) : AbortSignal.timeout(WRITE_UP_MS);
      const res: ModelResult = await drain(callModel(`${info.id}-extract`, outcomeMessages(plan.question, run.answer, run.sources), cdeps.model, { signal: writeUp, round: i, maxTokens: 700, accept: (t) => parseOutcome(t) !== null }));
      outcome = (res.ok ? parseOutcome(res.text) : null) ?? fallbackOutcome(run.answer);
      yield wrap({ kind: "step", agent: "main", id: "write-up", label: "Wrote up the outcome", state: "ok" });
    }
    outcomes.set(info.id, outcome);
    factsBy.set(info.id, facts);
    sourcesBy.set(info.id, run.sources.map((s) => ({ n: s.n, host: s.host, title: s.title })));
    yield { kind: "contender_done", id: info.id, outcome, facts, ok: !facts.failed };
    await a.close(sess).catch(() => undefined);
  };

  /** The blind judge: reports are labelled A, B, C in a shuffled order, with no names. Returns scores best first. */
  async function* judge(ids: readonly string[], seed: string, round?: number): AsyncGenerator<CEvent, { scores: Score[]; judge: string | null; why?: string }> {
    yield { kind: "arena_phase", phase: "judging", note: `${ids.length} report${ids.length === 1 ? "" : "s"}, labelled so the judge cannot tell who wrote which` };
    const map = labelMap(ids, seed);
    const det = Object.fromEntries(ids.map((id) => [id, detScore(factsBy.get(id)!, outcomes.get(id) ?? null)]));
    const withReport = ids.filter((id) => outcomes.get(id));
    let judged: Judgement | null = null;
    let family: string | null = null;
    if (withReport.length >= 2) {
      const labels = Object.entries(map).filter(([, id]) => withReport.includes(id)).map(([l]) => l);
      const used = infos.map((c) => familyOf(pins[infos.indexOf(c)]?.model ?? ""));
      const jm = { ...deps.model, models: judgeOrder(deps.model.models, used, familyOf), hedge: 1, rotate: false };
      yield { kind: "step", agent: "main", id: `judge-${round ?? 0}`, label: `Blind judge scoring ${labels.length} reports`, state: "running" };
      const items = labels.map((l) => ({ label: l, outcome: outcomes.get(map[l])!, facts: factsBy.get(map[l])! }));
      const res = yield* callModel("main", judgeMessages(plan.question, items, hideNames), jm, { signal, round: 0, maxTokens: 1400, accept: (t) => parseJudge(t, labels) !== null });
      judged = res.ok ? parseJudge(res.text, labels) : null;
      family = res.ok && judged ? familyOf(deps.model.models.find((m) => m.model.split("/").pop()?.replace(/:free$/i, "") === res.model.replace(/:free$/i, ""))?.model ?? res.model) : null;
      yield { kind: "step", agent: "main", id: `judge-${round ?? 0}`, label: judged ? "Blind judge scored the reports" : "Blind judge could not answer", state: judged ? "ok" : "error", detail: judged ? `a ${family} model` : "scores use only what was counted" };
    }
    const scores = scoreAll(ids, det, judged, map);
    return { scores, judge: family, why: judged?.why };
  }

  const entriesFor = (ids: readonly string[], scores: readonly Score[]): Entry[] =>
    ids.map((id): Entry => ({ id, name: names[id], outcome: outcomes.get(id) ?? null, facts: factsBy.get(id) ?? null, score: scores.find((s) => s.id === id)!, sources: sourcesBy.get(id) ?? [] }));

  let scores: Score[] = [];
  let judgeFamily: string | null = null;
  let judgeWhy: string | undefined;
  let winnerId = "";
  let stopNote = "";

  if (kind === "battle") {
    const slots = plan.slots;
    slots.forEach((s, i) => { const info = infoFor(i, s, kind, pins[i]?.model); infos.push(info); names[info.id] = info.name; });
    const bracket = buildBracket(infos.map((c) => c.id), session.id);
    yield { kind: "arena", mode: kind, plan: input.planMode, scenario: input.prompt, question: plan.question, max: slots.length, adaptive: false, contenders: infos, bracket };
    yield { kind: "arena_phase", phase: "running", note: `${slots.length} teams, each on its own model, ${Math.min(PARALLEL, slots.length)} at a time` };
    const settled = yield* mergeStreams(slots.map((s, i) => contender(infos[i], s, i)), PARALLEL);
    settled.forEach((r, i) => { if (!r.ok) { outcomes.set(infos[i].id, outcomes.get(infos[i].id) ?? null); if (!factsBy.has(infos[i].id)) factsBy.set(infos[i].id, { sources: 0, cited: 0, roles: [], files: 0, failed: true }); } });
    // The knockout: every match is the two reports judged side by side, blind. Health decides who goes through.
    const ids = infos.map((c) => c.id);
    const det = Object.fromEntries(ids.map((id) => [id, detScore(factsBy.get(id)!, outcomes.get(id) ?? null)]));
    const hp: Record<string, number> = Object.fromEntries(ids.map((id) => [id, MAX_HP]));
    const results: Result[] = [];
    const judgments: Judged[] = [];
    yield { kind: "arena_phase", phase: "judging", note: "knockout: each match is judged blind, side by side" };
    for (const m of bracket.rounds[0]) {
      if (!m.bye) continue;
      const only = (m.a.id ?? m.b.id)!;
      results.push({ matchId: m.id, winner: only });
      yield { kind: "arena_match", match: { id: m.id, label: m.label, round: m.round, a: m.a.id, b: m.b.id, winner: only, loser: null, bye: true, duel: null, why: null, judged: false, hpAfter: null, hpNext: null } };
    }
    const used = infos.map((c, i) => familyOf(pins[i]?.model ?? ""));
    const jm = { ...deps.model, models: judgeOrder(deps.model.models, used, familyOf), hedge: 1, rotate: false };
    for (let m = nextMatch(bracket, results); m; m = nextMatch(bracket, results)) {
      if (signal?.aborted) return;
      const view = resolve(bracket, results);
      const filled = [...view.rounds.flat(), ...(view.third ? [view.third] : [])].find((x) => x.id === m!.id)!;
      const [ida, idb] = [filled.a.id!, filled.b.id!];
      const stepId = `match-${m.id}`;
      yield { kind: "step", agent: "main", id: stepId, label: `${m.label}: ${names[ida]} against ${names[idb]}`, state: "running" };
      let sides: { a: Judged; b: Judged; why?: string } | null = null;
      const bothReported = !!outcomes.get(ida) && !!outcomes.get(idb);
      if (bothReported) {
        const map = labelMap([ida, idb], `${session.id}:${m.id}`);
        const labels = Object.keys(map);
        const items = labels.map((l) => ({ label: l, outcome: outcomes.get(map[l])!, facts: factsBy.get(map[l])! }));
        const res = yield* callModel("main", judgeMessages(plan.question, items, hideNames), jm, { signal, round: 0, maxTokens: 900, accept: (t) => parseJudge(t, labels) !== null });
        const got = res.ok ? parseJudge(res.text, labels) : null;
        if (got) {
          const labelOf = Object.fromEntries(Object.entries(map).map(([l, id]) => [id, l]));
          sides = { a: { id: ida, dims: got.byLabel[labelOf[ida]].dims, weakness: got.byLabel[labelOf[ida]].weakness }, b: { id: idb, dims: got.byLabel[labelOf[idb]].dims, weakness: got.byLabel[labelOf[idb]].weakness }, why: got.why };
          judgeFamily = familyOf(deps.model.models.find((x) => x.model.split("/").pop()?.replace(/:free$/i, "") === (res.ok ? res.model : "").replace(/:free$/i, ""))?.model ?? (res.ok ? res.model : ""));
          judgments.push(sides.a, sides.b);
        }
      }
      const fa: Fighter = { id: ida, hp: hp[ida], dims: sides?.a.dims ?? null, det: det[ida], facts: factsBy.get(ida) ?? null };
      const fb: Fighter = { id: idb, hp: hp[idb], dims: sides?.b.dims ?? null, det: det[idb], facts: factsBy.get(idb) ?? null };
      const d = duel(fa, fb);
      const winner = d.winner === "a" ? ida : idb;
      const loser = d.winner === "a" ? idb : ida;
      hp[ida] = d.hp.a;
      hp[idb] = d.hp.b;
      hp[winner] = recover(hp[winner]);
      results.push({ matchId: m.id, winner });
      judgeWhy = sides?.why ?? judgeWhy;
      const match: MatchResult = { id: m.id, label: m.label, round: m.round, a: ida, b: idb, winner, loser, bye: false, duel: d, why: whyResult(d, { a: names[ida], b: names[idb] }), judged: !!sides, ...(sides ? {} : { unjudged: bothReported ? ("no_judge" as const) : ("no_report" as const) }), judgeWhy: sides?.why, hpAfter: d.hp, hpNext: hp[winner] };
      yield { kind: "step", agent: "main", id: stepId, label: `${m.label}: ${names[winner]} ${d.ko ? "knocks out" : "beats"} ${names[loser]}`, state: "ok", detail: sides ? undefined : bothReported ? "no judge answered: decided on what was counted" : "a team has no report: decided on what was counted" };
      yield { kind: "arena_match", match };
    }
    const order = standings(bracket, results, hp);
    winnerId = order[0];
    scores = order.map((id) => meanScores([id], det, judgments)[0]);
    yield { kind: "arena_scores", scores, winner: winnerId, judge: judgeFamily, why: judgeWhy };
  } else {
    // Loop: one team per round, each on a different scenario, until the best answer is good enough or stops improving.
    const tried: string[] = [];
    const best: number[] = [];
    let bestId = "";
    const planned = plan.slots;
    if (!adaptive) {
      planned.forEach((s, i) => { const info = infoFor(i, s, kind, pins[i]?.model); infos.push(info); names[info.id] = info.name; });
      yield { kind: "arena", mode: kind, plan: input.planMode, scenario: input.prompt, question: plan.question, max: planned.length, adaptive: false, contenders: infos };
    } else {
      yield { kind: "arena", mode: kind, plan: input.planMode, scenario: input.prompt, question: plan.question, max: planned.length, adaptive: true, contenders: [] };
    }
    yield { kind: "arena_phase", phase: "running", note: adaptive ? "each round's scenario is chosen from what the best answer still lacks" : "running your scenarios in order" };
    for (let r = 0; r < planned.length; r++) {
      if (signal?.aborted) return;
      if (a.now() - t0 > START_NO_NEW_AFTER_MS) { stopNote = "time"; break; }
      let slot = planned[r];
      if (adaptive && r > 0) {
        // the next scenario attacks what the best answer so far still lacks
        const bestEntry = bestId && outcomes.get(bestId) ? { headline: outcomes.get(bestId)?.headline ?? "", weakness: scores.find((s) => s.id === bestId)?.weakness } : null;
        yield { kind: "step", agent: "main", id: `scenario-${r + 1}`, label: `Choosing scenario for round ${r + 1}`, state: "running" };
        const res = yield* callModel("main", scenarioMessages(plan.question, tried, bestEntry), deps.model, { signal, round: r, maxTokens: 300, accept: (t) => parseScenario(t, tried) !== null });
        const next = (res.ok ? parseScenario(res.text, tried) : null) ?? nextLens(tried);
        slot = { ...slot, scenario: next };
        yield { kind: "step", agent: "main", id: `scenario-${r + 1}`, label: `Round ${r + 1} scenario: ${next.name}`, state: "ok", detail: next.change };
      }
      if (slot.scenario) tried.push(slot.scenario.name);
      const info = infoFor(r, slot, kind, pins[r]?.model);
      const bestEntry = bestId && outcomes.get(bestId) ? { headline: outcomes.get(bestId)?.headline ?? "", weakness: scores.find((s) => s.id === bestId)?.weakness } : undefined;
      // the round learns what it has to beat; a planned round is updated in place, an adaptive one is added now
      if (bestEntry) info.beat = { ...bestEntry, score: scores.find((s) => s.id === bestId)?.total ?? 0 };
      if (adaptive) { infos.push(info); names[info.id] = info.name; yield { kind: "contender_add", info }; }
      else { infos[r] = info; if (info.beat) yield { kind: "contender_add", info }; }
      yield* contender(info, slot, r, bestEntry)();
      if (!factsBy.has(info.id)) factsBy.set(info.id, { sources: 0, cited: 0, roles: [], files: 0, failed: true });
      const ids = infos.slice(0, r + 1).map((c) => c.id);
      const j = yield* judge(ids, `${session.id}:${r}`, r + 1);
      scores = j.scores; judgeFamily = j.judge; judgeWhy = j.why;
      bestId = scores[0].id;
      // A round that wrote no report says nothing about whether the answer has stopped improving (the models failed, not the idea), so it is not counted
      // toward the stop rules: the loop goes on to the next scenario instead of ending with "the last round did not beat it".
      const reported = !!outcomes.get(info.id);
      if (reported) best.push(scores[0].total);
      yield { kind: "arena_scores", scores, winner: bestId, judge: judgeFamily, why: judgeWhy, round: r + 1 };
      const stop = reported ? loopStop(best, planned.length) : { stop: false, reason: null };
      if (stop.stop) { stopNote = stop.reason === "good_enough" ? `the best answer scored ${scores[0].total}, at least ${LOOP_GOOD_ENOUGH}, and the last round did not beat it` : stop.reason === "no_progress" ? "two rounds in a row brought no improvement" : "all planned scenarios were run"; break; }
      yield { kind: "arena_phase", phase: "running", note: `best so far ${scores[0].total} out of 10` };
    }
    winnerId = bestId;
    if (!winnerId) {
      yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "error", ms: a.now() - t0 };
      yield { kind: "error", message: "No round finished, so there is no answer." };
      return;
    }
  }

  // Write-up: the winner plus the best verified points of the others.
  const ids = infos.filter((c) => outcomes.has(c.id)).map((c) => c.id);
  const all = entriesFor(ids, scores);
  const winner = all.find((e) => e.id === winnerId)!;
  yield { kind: "arena_phase", phase: "writing", note: stopNote ? `Loop stopped: ${stopNote}` : undefined };
  yield { kind: "step", agent: "main", id: "write", label: "Writing the combined outcome", state: "running" };
  let text = "";
  if (winner.outcome) {
    const others = all.filter((e) => e.id !== winnerId && e.outcome).map((e) => ({ name: e.name, outcome: e.outcome!, total: e.score.total }));
    const g = callModel("main", synthMessages(plan.question, { name: winner.name, outcome: winner.outcome, weakness: winner.score.weakness }, others), deps.model, { signal, round: 1, maxTokens: 700, answerDeltas: true, accept: (t) => t.trim().length > 40 });
    let streamed = "";
    for (;;) {
      const n = await g.next();
      if (n.done) { text = n.value.ok ? n.value.text.trim() : ""; break; }
      if (n.value.kind === "answer") streamed += n.value.delta;
      yield n.value;
    }
    if (!text) streamed = "";
    if (text && streamed === "") yield { kind: "answer", delta: text };
  }
  if (!text) { text = fallbackFinalText(winner); yield { kind: "answer", delta: text }; }
  const final: ArenaFinal = { winner: winnerId, text, provenance: parseProvenance(text, names), why: judgeWhy ?? "", judge: judgeFamily };
  yield { kind: "step", agent: "main", id: "write", label: "Wrote the combined outcome", state: "ok" };
  yield { kind: "arena_final", final };

  // Files for later: the whole contest as a report and a score table.
  const ctx = { agent: "main", session, deps };
  yield* writeArtifact(ctx, `${kind}-report.md`, reportMarkdown({ title: `${label} report`, mode: kind, question: plan.question, entries: all, winnerId, final, judgeWhy }));
  yield* writeArtifact(ctx, `${kind}-scores.csv`, scoresCsv(all, winnerId));

  session.history = pushHistory(pushHistory(session.history, { role: "user", content: `[${label}] ${input.prompt}` }), { role: "assistant", content: text });
  yield { kind: "arena_phase", phase: "done" };
  yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "ok", ms: a.now() - t0 };
  yield { kind: "done", used: usedSources(text, session.sources.length), model: `${label} · ${PLAN_LABEL[input.planMode].title}`, ms: a.now() - t0 };
}

/**
 * The most time drafting a plan may take, the question and the scenarios together. Measured live 2026-11-12: a draft takes 28 to 43 s, and with no limit a
 * bad minute on the free providers (each model is tried in turn, up to 40 s each) left the screen on "Drafting the scenarios" for minutes. When the time is
 * up the fixed line-up is used, which is what a draft that no model could write gets anyway.
 */
export const PLAN_MS = 55_000;

/** Drafts a plan for the Review step (AI draft) or for Autopilot. Always returns a valid plan; `drafted` says whether a model wrote it. */
export async function proposePlan(kind: Plan["kind"], n: number, scenario: string, deps: Deps, signal?: AbortSignal, limitMs: number = PLAN_MS): Promise<{ plan: Plan; drafted: boolean }> {
  const limit = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(limitMs)]);
  // each call races the run's usual number of models (two on Standard), so one slow model does not set the pace
  const bres = await drain(callModelHedged("plan", briefMessages(scenario), deps.model, { signal: limit, round: 0, maxTokens: 300, accept: (t) => parseBrief(t, scenario).question !== scenario.trim().slice(0, 300) }));
  const brief = parseBrief(bres.ok ? bres.text : null, scenario);
  const res = await drain(callModelHedged("plan", planMessages(kind, n, scenario, brief.question), deps.model, { signal: limit, round: 1, maxTokens: 900 }));
  const out = planFromDraft(res.ok ? res.text : null, kind, n, { question: brief.question });
  return { plan: { ...out.plan, success: out.plan.success || brief.success, horizon: out.plan.horizon || brief.horizon }, drafted: out.drafted };
}

