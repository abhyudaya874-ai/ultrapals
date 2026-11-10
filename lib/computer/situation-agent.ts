import type { ChatMessage } from "@/lib/integrations/chat";
import { generateId } from "./ids";
import { pagesFrom } from "@/lib/pals/generate";
import type { ProbeRow } from "@/lib/pals/probe";
import type { FetchedPage } from "@/lib/pals/rival";
import {
  DEFAULT_NEEDS, RAILS, buildSituationCard, classifierMessages, mergeCells, needsMessages, parseCells, parseNeeds, queriesFor, railName, summarizeSituation, unknownCells, verifyCells,
  type Cell, type Need, type RailId, type StopReason,
} from "@/lib/pals/situation";
import { mergeStreams } from "@/lib/swarm/tree/merge";
import { admitSpawn } from "@/lib/swarm/tree/policy";
import { SPAWNS, jobKey, type Caps, type SpawnRequest, type TreeNode } from "@/lib/swarm/tree/types";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModelHedged } from "./model";

const MAX_ROUNDS = 3;
const MAX_SEARCHES = 27;
const PARALLEL = 4;
const SEARCH_MS = 9_000;
const WINDOW_MS = 240_000;
const PROBED: readonly RailId[] = ["stripe", "square", "paypal"];

const ROOT: Caps = { spawn: SPAWNS.root, tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS };
const PAL: Caps = { spawn: SPAWNS.pal, tools: ["tavily", "exa", "fetch"], maxCalls: 0, maxMs: WINDOW_MS };
const req = (kind: "pal" | "research" | "observe", task: string, why: string, input: Record<string, unknown>): SpawnRequest => ({ kind, mode: "script", task, why, input, ask: { calls: 0, ms: SEARCH_MS }, expects: kind === "observe" ? "observations" : "sources" });

/**
 * SituationPal: an idea in plain words -> which payment needs it has (closed list) -> every rail gets its own Pal; each Pal's
 * ResearchPals search Tavily and Exa in rounds, a classifier reads the pages, and every claim must quote the page it came from.
 * The rounds chain until each (rail, need) has a cited answer or a budget ends; the card says which. Stripe, Square and PayPal also
 * get real SandboxPal checks (test and sandbox environments only; PayPal read-only). Nothing here decides a verdict or moves money.
 */
export async function* runSituationAgent(ctx: SubCtx, idea: string): AsyncGenerator<CEvent, string> {
  const { agent, deps, signal, session } = ctx;
  const now = Date.now;
  const t0 = now();
  const searchers = deps.search.filter((s) => s.id === "tavily" || s.id === "exa");
  const railIds = RAILS.map((r) => r.id) as RailId[];
  let modelRound = 0;
  const ask = async (messages: ChatMessage[], accept?: (t: string) => boolean): Promise<string | null> => {
    const g = callModelHedged(agent, messages, deps.model, { signal, round: modelRound++, maxTokens: 2400, accept });
    for (;;) {
      const n = await g.next();
      if (n.done) return n.value.ok ? n.value.text : null;
    }
  };

  // 1. what does this idea need?
  yield { kind: "step", agent, id: "needs", label: "Working out what the idea needs from a payment rail", state: "running" };
  const tn = now();
  const reply = await ask(needsMessages(idea), (t) => parseNeeds(t).length > 0);
  const parsed = reply ? parseNeeds(reply) : [];
  const needs: Need[] = parsed.length ? parsed : DEFAULT_NEEDS;
  yield { kind: "step", agent, id: "needs", label: "Worked out what the idea needs from a payment rail", state: parsed.length ? "ok" : "error", detail: parsed.length ? needs.map((n) => `${n.need} ${n.weight}`).join(", ") : "no model could read it; using default needs", ms: now() - tn };

  // 2. one Pal per rail, each admitted by the spawn policy
  const nodes: TreeNode[] = [{ id: agent, parent: null, kind: "root", mode: "script", key: `root:${agent}`, depth: 0, caps: ROOT, callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" }];
  const add = (n: Pick<TreeNode, "id" | "parent" | "kind" | "key" | "depth" | "caps">): void => void nodes.push({ ...n, mode: "script", callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" });
  const palIds = new Map<RailId, string>();
  for (const rail of railIds) {
    const id = `superpal-${rail}`;
    const r = req("pal", `${railName(rail)} answers for its rail`, "every rail in the comparison gets its own Pal so its evidence stays separate", { rail });
    const d = admitSpawn({ nodes }, agent, r, now());
    if (!d.ok) {
      yield { kind: "spawn", parent: agent, child: id, why: r.why, decision: "denied", detail: d.why };
      continue;
    }
    yield { kind: "spawn", parent: agent, child: id, why: r.why, decision: "admitted" };
    add({ id, parent: agent, kind: "pal", key: jobKey(r), depth: 1, caps: PAL });
    palIds.set(rail, id);
    yield { kind: "message", id: `to-${id}`, from: agent, to: id, text: `Find what ${railName(rail)} publishes about: ${needs.map((n) => n.need.replace(/_/g, " ")).join(", ")}.` };
    yield { kind: "agent", id, role: "superpal", title: `${railName(rail)} Pal`, state: "running", parent: agent };
  }
  const live = railIds.filter((r) => palIds.has(r));

  // 3. sandbox checks run alongside round 1
  const probes: ProbeRow[] = [];
  const runId = generateId();
  const probeTask = (rail: RailId) => async function* (): AsyncGenerator<CEvent, void> {
    const pal = palIds.get(rail);
    if (!pal) return;
    const id = `sandbox-${rail}`;
    const r = req("observe", `${railName(rail)} sandbox checks`, rail === "paypal" ? "read-only: a typed error and the last real promise run" : "real calls against their test environment with a test token", { rail });
    const d = admitSpawn({ nodes }, pal, r, now());
    if (!d.ok) { yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "denied", detail: d.why }; return; }
    yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "admitted" };
    add({ id, parent: pal, kind: "observe", key: jobKey(r), depth: 2, caps: { spawn: [], tools: [], maxCalls: 0, maxMs: WINDOW_MS } });
    const ts = now();
    yield { kind: "agent", id, role: "sandbox", title: "SandboxPal", state: "running", parent: pal };
    yield { kind: "step", agent: id, id: "probe", label: `Running ${railName(rail)} sandbox checks`, state: "running" };
    const res = rail === "stripe" ? await deps.probes.stripe(runId, signal) : rail === "square" ? await deps.probes.square(runId, signal) : await deps.probes.paypal(session.lastPromiseRun ?? null, signal);
    if (res.ok) {
      probes.push(...res.data);
      const pass = res.data.filter((x) => x.outcome === "pass").length;
      yield { kind: "step", agent: id, id: "probe", label: `Ran ${railName(rail)} sandbox checks`, state: "ok", detail: `${pass}/${res.data.length} pass`, ms: now() - ts };
    } else {
      yield { kind: "step", agent: id, id: "probe", label: `Ran ${railName(rail)} sandbox checks`, state: "error", detail: res.reason, ms: now() - ts };
    }
    yield { kind: "agent", id, role: "sandbox", title: "SandboxPal", state: res.ok ? "ok" : "error", ms: now() - ts, parent: pal };
  };

  // 4. research rounds, chained until every needed cell has a cited answer or a budget ends
  const pagesByRail = new Map<RailId, FetchedPage[]>();
  let cells: Cell[] = [];
  let searches = 0;
  let rounds = 0;
  let stop: StopReason = searchers.length ? "max_rounds" : "no_search";
  const tick = (rail: RailId, round: number, i: number) => `research-${rail}-${round}-${i}`;

  for (let round = 1; searchers.length > 0; round++) {
    const unknown = unknownCells(live, needs, cells);
    if (unknown.length === 0) { stop = "complete"; break; }
    if (round > MAX_ROUNDS) { stop = "max_rounds"; break; }
    if (searches >= MAX_SEARCHES) { stop = "search_budget"; break; }
    rounds = round;

    const jobs = live.flatMap((rail) => queriesFor(rail, unknown.filter((u) => u.rail === rail).map((u) => u.need)).map((q, i) => ({ rail, q, i })));
    const jobsLeft = jobs.slice(0, MAX_SEARCHES - searches);
    yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: searching for ${unknown.length} unanswered (rail, need) pairs`, state: "running", detail: `${jobsLeft.length} searches` };
    const tr = now();
    const fresh = new Map<RailId, FetchedPage[]>();

    const searchTask = (job: { rail: RailId; q: string; i: number }, n: number) => async function* (): AsyncGenerator<CEvent, void> {
      const pal = palIds.get(job.rail)!;
      const id = tick(job.rail, round, job.i);
      const r = req("research", job.q, "a cited line beats a guess about what this rail supports", { q: job.q });
      const d = admitSpawn({ nodes }, pal, r, now());
      if (!d.ok) { yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "denied", detail: d.why }; return; }
      if (d.reuse) { yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "reused", detail: d.reuse }; return; }
      yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "admitted" };
      add({ id, parent: pal, kind: "research", key: jobKey(r), depth: 2, caps: { spawn: [], tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS } });
      const s = searchers[n % searchers.length];
      const ts = now();
      yield { kind: "agent", id, role: "research", title: "ResearchPal", state: "running", parent: pal };
      yield { kind: "step", agent: id, id: "search", label: `Searching ${s.label}: ${job.q.slice(0, 70)}`, state: "running" };
      searches++;
      try {
        const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_MS)]) : AbortSignal.timeout(SEARCH_MS);
        const res = await s.run(job.q, sig);
        if (res.ok) {
          const ps = pagesFrom([{ id: s.id as "tavily" | "exa", data: res.data }], now());
          fresh.set(job.rail, [...(fresh.get(job.rail) ?? []), ...ps]);
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "ok", detail: `${ps.length} pages`, ms: now() - ts };
        } else {
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "error", detail: res.reason, ms: now() - ts };
        }
      } catch (e) {
        yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "error", detail: e instanceof Error ? e.message : "failed", ms: now() - ts };
      }
      yield { kind: "agent", id, role: "research", title: "ResearchPal", state: "ok", ms: now() - ts, parent: pal };
    };

    const tasks = [...(round === 1 ? PROBED.map(probeTask) : []), ...jobsLeft.map((j, n) => searchTask(j, n + round))];
    yield* mergeStreams(tasks, PARALLEL);
    for (const [rail, ps] of fresh) {
      const have = pagesByRail.get(rail) ?? [];
      const urls = new Set(have.map((p) => p.url));
      pagesByRail.set(rail, [...have, ...ps.filter((p) => !urls.has(p.url))].slice(0, 6));
    }

    // classify this round's new pages; every claim must quote its page
    let added = 0;
    if (fresh.size > 0) {
      const view = new Map([...fresh.keys()].map((r) => [r, pagesByRail.get(r) ?? []] as const));
      const targets = unknown.filter((u) => view.has(u.rail));
      const out = await ask(classifierMessages(idea, needs, targets, view), (t) => parseCells(t).length > 0);
      const v = verifyCells(out ? parseCells(out) : [], pagesByRail, needs.map((n) => n.need));
      const before = cells.length;
      cells = mergeCells(cells, v.kept);
      added = cells.length - before;
      yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: classified the pages`, state: "ok", detail: `${added} cited answers kept, ${v.dropped.length} dropped by cite-or-die`, ms: now() - tr };
    } else {
      yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: nothing came back`, state: "error", detail: "no pages", ms: now() - tr };
    }
    if (added === 0 && round > 1) { stop = "no_progress"; break; }
    if (searches >= MAX_SEARCHES) { stop = "search_budget"; break; }
  }

  // probes still owed when there was no search at all
  if (rounds === 0) for await (const _ of mergeStreams(PROBED.map(probeTask), PARALLEL)) void _;
  const finalStop = unknownCells(live, needs, cells).length === 0 ? "complete" : stop;

  const card = buildSituationCard({ idea, needs, needsDefaulted: parsed.length === 0, cells, probes, rounds, searches, stop: finalStop, railIds: live });
  for (const rail of live) {
    const id = palIds.get(rail)!;
    const sc = card.rails.find((r) => r.rail === rail)!;
    const mine = probes.filter((p) => p.rail === rail);
    yield { kind: "agent", id, role: "superpal", title: `${railName(rail)} Pal`, state: "ok", parent: agent, ms: now() - t0 };
    yield { kind: "message", id: `from-${id}`, from: id, to: agent, text: `fit ${Math.round(sc.fit * 100)}%–${Math.round(sc.upper * 100)}%, ${sc.parts.filter((p) => p.support !== "unknown").length}/${sc.parts.length} needs cited${mine.length ? `; sandbox ${mine.filter((p) => p.outcome === "pass").length}/${mine.length} checks pass` : ""}.` };
  }
  yield { kind: "situation", agent, card };
  return summarizeSituation(card);
}
