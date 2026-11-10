import type { ChatMessage } from "@/lib/integrations/chat";
import { familyOf, familyOfBare } from "@/lib/pals/family";
import { pagesFrom } from "@/lib/pals/generate";
import type { ProbeRow } from "@/lib/pals/probe";
import { MIN_KNOWN, blindMessages, contenders, judgeRecommendation, parseBlind, separated, type BlindResult } from "@/lib/pals/recommend";
import { cardHash, receiptId } from "@/lib/pals/receipt";
import type { FetchedPage } from "@/lib/pals/rival";
import {
  DEFAULT_NEEDS, RAILS, buildSituationCard, classifierMessages, mergeCellsDetail, needsMessages, parseCells, parseNeeds, parseRails, parseScoutQueries, queriesFor, scoreRails, scoutMessages, scoutPlanMessages, scoutQueries,
  summarizeSituation, unknownCells, verifyCells, verifyRails, type Cell, type Need, type RailDef, type StopReason,
} from "@/lib/pals/situation";
import { mergeStreams } from "@/lib/swarm/tree/merge";
import { admitSpawn } from "@/lib/swarm/tree/policy";
import { SPAWNS, jobKey, type Caps, type SpawnRequest, type TreeNode } from "@/lib/swarm/tree/types";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { generateId } from "./ids";
import { callModelHedged } from "./model";
import { csvOf, writeArtifact } from "./artifacts";
import { readPage } from "./reader";
import { hostOfUrl, readVisit, searchVisit } from "./visits";

const MAX_ROUNDS = 4;
const MAX_SEARCHES = 40;
const PARALLEL = 4;
const SEARCH_MS = 9_000;
const WINDOW_MS = 270_000;
const PROBED = ["stripe", "square", "paypal"] as const;
const MAX_READS_PER_ROUND = 4;

const ROOT: Caps = { spawn: SPAWNS.root, tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS };
const PAL: Caps = { spawn: SPAWNS.pal, tools: ["tavily", "exa", "fetch"], maxCalls: 0, maxMs: WINDOW_MS };
const req = (kind: "pal" | "research" | "observe", task: string, why: string, input: Record<string, unknown>): SpawnRequest => ({ kind, mode: "script", task, why, input, ask: { calls: 0, ms: SEARCH_MS }, expects: kind === "observe" ? "observations" : "sources" });

/**
 * SituationPal, run the Case Desk way:
 *   intake (the idea -> needs from a closed list)  ->  evidence (rails found by a scout, each cited; Pals research them in rounds, losers
 *   eliminated, until one rail's cited fit beats every other's best case)  ->  rubric (pure: APPROVE / HOLD / FLAG)  ->  blind check (a
 *   DIFFERENT model family sees only the typed grid)  ->  hashed receipt that a person confirms.
 * It recommends; it never moves money, never rejects, and holds no PayPal write tool.
 */
export async function* runSituationAgent(ctx: SubCtx, idea: string): AsyncGenerator<CEvent, string> {
  const { agent, deps, signal, session } = ctx;
  const now = Date.now;
  const t0 = now();
  const searchers = deps.search.filter((s) => s.id === "tavily" || s.id === "exa");
  let modelRound = 0;
  // The blind reader's family is fixed up front (the second family in the roster), and every other call is kept off it, so the blind
  // check can never share a family with the model that classified the evidence. One family only = no blind check (HOLD).
  const families = [...new Set(deps.model.models.filter((m) => m.model !== "openrouter/free").map((m) => familyOf(m.model)))];
  const blindFamily = families.length >= 2 ? families[1] : null;
  const mainModels = { ...deps.model, models: blindFamily ? deps.model.models.filter((m) => familyOf(m.model) !== blindFamily) : deps.model.models };
  // Every model call is a visible step and streams the model's reasoning, so the thread never goes quiet while a model works.
  const ask = async function* (what: string, messages: ChatMessage[], accept?: (t: string) => boolean, models = mainModels): AsyncGenerator<CEvent, { text: string; family: string } | null> {
    const k = modelRound++;
    const id = `ask-${k}`;
    const t = now();
    yield { kind: "step", agent, id, label: what, state: "running" };
    const r = yield* callModelHedged(agent, messages, models, { signal, round: k, maxTokens: 2400, accept });
    yield { kind: "step", agent, id, label: what, state: r.ok ? "ok" : "error", detail: r.ok ? `answered by ${r.model}` : r.error.slice(0, 100), ms: now() - t };
    return r.ok ? { text: r.text, family: familyOfBare(r.model, deps.model.models) } : null;
  };
  const askMain = async function* (what: string, messages: ChatMessage[], accept?: (t: string) => boolean): AsyncGenerator<CEvent, string | null> {
    return (yield* ask(what, messages, accept))?.text ?? null;
  };

  // 1. intake: what does this idea need?
  yield { kind: "step", agent, id: "needs", label: "Working out what the idea needs from a payment rail", state: "running" };
  const tn = now();
  const parsed = parseNeeds((yield* askMain("Reading the idea", needsMessages(idea), (t) => parseNeeds(t).length > 0)) ?? "");
  const needs: Need[] = parsed.length ? parsed : DEFAULT_NEEDS;
  yield { kind: "step", agent, id: "needs", label: "Worked out what the idea needs from a payment rail", state: parsed.length ? "ok" : "error", detail: parsed.length ? needs.map((n) => `${n.need} ${n.weight}`).join(", ") : "no model could read it; using default needs", ms: now() - tn };

  const nodes: TreeNode[] = [{ id: agent, parent: null, kind: "root", mode: "script", key: `root:${agent}`, depth: 0, caps: ROOT, callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" }];
  const add = (n: Pick<TreeNode, "id" | "parent" | "kind" | "key" | "depth" | "caps">): void => void nodes.push({ ...n, mode: "script", callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" });
  const palIds = new Map<string, string>();
  const spawnPal = async function* (id: string, title: string, rail: string, task: string, why: string): AsyncGenerator<CEvent, boolean> {
    const r = req("pal", task, why, { rail });
    const d = admitSpawn({ nodes }, agent, r, now());
    if (!d.ok) { yield { kind: "spawn", parent: agent, child: id, why, decision: "denied", detail: d.why }; return false; }
    yield { kind: "spawn", parent: agent, child: id, why, decision: "admitted" };
    add({ id, parent: agent, kind: "pal", key: jobKey(r), depth: 1, caps: PAL });
    yield { kind: "message", id: `to-${id}`, from: agent, to: id, text: task };
    yield { kind: "agent", id, role: "superpal", title, state: "running", parent: agent };
    return true;
  };

  // 2. scout: the models propose rails beyond the seeds; a page must name each one
  let defs: RailDef[] = [...RAILS];
  const discovered: { id: string; name: string; url: string; quote: string }[] = [];
  if (searchers.length > 0) {
    const scoutId = "superpal-scout";
    if (yield* spawnPal(scoutId, "ScoutPal", "scout", `Find payment providers beyond ${RAILS.map((r) => r.name).join(", ")} that suit: ${idea.slice(0, 160)}`, "the best rail may not be one of the nine we know; the web names the others")) {
      const ts = now();
      const planned = parseScoutQueries((yield* askMain("Planning where to look for other providers", scoutPlanMessages(idea), (t) => parseScoutQueries(t).length > 0)) ?? "");
      const queries = (planned.length ? planned : scoutQueries(idea)).slice(0, 3);
      const found: { id: "tavily" | "exa"; data: import("@/lib/integrations/types").WebSource[] }[] = [];
      const scoutTask = (q: string, n: number) => async function* (): AsyncGenerator<CEvent, void> {
        const id = `research-scout-${n}`;
        const r = req("research", q, "look for providers the comparison does not have yet", { q });
        const d = admitSpawn({ nodes }, scoutId, r, now());
        if (!d.ok || d.reuse) return;
        add({ id, parent: scoutId, kind: "research", key: jobKey(r), depth: 2, caps: { spawn: [], tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS } });
        yield { kind: "agent", id, role: "research", title: "ResearchPal", state: "running", parent: scoutId };
        const s = searchers[n % searchers.length];
        const tq = now();
        yield { kind: "step", agent: id, id: "search", label: `Searching ${s.label}: ${q.slice(0, 70)}`, state: "running" };
        try {
          const res = await s.run(q, signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_MS)]) : AbortSignal.timeout(SEARCH_MS));
          if (res.ok) {
            found.push({ id: s.id as "tavily" | "exa", data: res.data });
            yield searchVisit(id, `${id}:s`, q, s.id as "tavily" | "exa", "ok", res.data.length);
            for (const w of res.data) yield readVisit(id, w.url, w.title, s.id as "tavily" | "exa");
          }
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: res.ok ? "ok" : "error", detail: res.ok ? `${res.data.length} pages` : res.reason, ms: now() - tq };
        } catch (e) {
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "error", detail: e instanceof Error ? e.message : "failed", ms: now() - tq };
        }
        yield { kind: "agent", id, role: "research", title: "ResearchPal", state: "ok", ms: now() - tq, parent: scoutId };
      };
      yield* mergeStreams(queries.map(scoutTask), PARALLEL);
      const pages = pagesFrom(found, now());
      let names = "";
      if (pages.length > 0) {
        const out = yield* askMain("Finding providers the pages name", scoutMessages(idea, pages, defs), (t) => parseRails(t).length > 0);
        const v = verifyRails(out ? parseRails(out) : [], pages, defs);
        for (const d of v.kept) { defs = [...defs, d]; discovered.push({ id: d.id, name: d.name, url: d.found!.url, quote: d.found!.quote }); }
        names = v.kept.map((d) => d.name).join(", ");
      }
      yield { kind: "agent", id: scoutId, role: "superpal", title: "ScoutPal", state: "ok", ms: now() - ts, parent: agent };
      yield { kind: "message", id: `from-${scoutId}`, from: scoutId, to: agent, text: names ? `Found ${discovered.length} more: ${discovered.map((d) => `${d.name} (${d.url})`).join("; ")}` : "No page named a provider beyond the nine we already compare." };
    }
  }

  // 3. one Pal per rail, each admitted by the spawn policy
  for (const d of defs) {
    const id = `superpal-${d.id}`;
    if (yield* spawnPal(id, `${d.name} Pal`, d.id, `Find what ${d.name} publishes about: ${needs.map((n) => n.need.replace(/_/g, " ")).join(", ")}.`, "every rail in the comparison gets its own Pal so its evidence stays separate")) palIds.set(d.id, id);
  }
  const live = defs.filter((d) => palIds.has(d.id));

  // 4. sandbox checks (Stripe and Square test environments; PayPal read-only), alongside round 1
  const probes: ProbeRow[] = [];
  const runId = generateId();
  const probeTask = (rail: (typeof PROBED)[number]) => async function* (): AsyncGenerator<CEvent, void> {
    const pal = palIds.get(rail);
    if (!pal) return;
    const id = `sandbox-${rail}`;
    const label = live.find((d) => d.id === rail)?.name ?? rail;
    const r = req("observe", `${label} sandbox checks`, rail === "paypal" ? "read-only: a typed error and the last real promise run" : "real calls against their test environment with a test token", { rail });
    const d = admitSpawn({ nodes }, pal, r, now());
    if (!d.ok) { yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "denied", detail: d.why }; return; }
    yield { kind: "spawn", parent: pal, child: id, why: r.why, decision: "admitted" };
    add({ id, parent: pal, kind: "observe", key: jobKey(r), depth: 2, caps: { spawn: [], tools: [], maxCalls: 0, maxMs: WINDOW_MS } });
    const ts = now();
    yield { kind: "agent", id, role: "sandbox", title: "SandboxPal", state: "running", parent: pal };
    yield { kind: "step", agent: id, id: "probe", label: `Running ${label} sandbox checks`, state: "running" };
    const res = rail === "stripe" ? await deps.probes.stripe(runId, signal) : rail === "square" ? await deps.probes.square(runId, signal) : await deps.probes.paypal(session.lastPromiseRun ?? null, signal);
    if (res.ok) {
      probes.push(...res.data);
      yield { kind: "step", agent: id, id: "probe", label: `Ran ${label} sandbox checks`, state: "ok", detail: `${res.data.filter((x) => x.outcome === "pass").length}/${res.data.length} pass`, ms: now() - ts };
    } else {
      yield { kind: "step", agent: id, id: "probe", label: `Ran ${label} sandbox checks`, state: "error", detail: res.reason, ms: now() - ts };
    }
    yield { kind: "agent", id, role: "sandbox", title: "SandboxPal", state: res.ok ? "ok" : "error", ms: now() - ts, parent: pal };
  };

  // 5. research in rounds until the best is met: contenders only, losers eliminated
  const pagesByRail = new Map<string, FetchedPage[]>();
  let cells: Cell[] = [];
  let conflicts = 0;
  let searches = 0;
  let rounds = 0;
  let stop: StopReason = searchers.length ? "max_rounds" : "no_search";
  const eliminated = new Set<string>();
  const fullRead = new Set<string>(); // pages already read in full (never read twice)
  const readFull = new Map<string, "fetch" | "browser" | "terminal">();

  for (let round = 1; searchers.length > 0; round++) {
    const scores = scoreRails(live, needs, cells);
    if (round > 1) {
      const cont = new Set(contenders({ rails: scores }));
      for (const s of scores) if (!cont.has(s.rail) && !eliminated.has(s.rail)) {
        eliminated.add(s.rail);
        yield { kind: "message", id: `from-superpal-${s.rail}-out`, from: palIds.get(s.rail)!, to: agent, text: `${s.name} is out: its best case (${Math.round(s.upper * 100)}%) cannot beat the leader's cited ${Math.round(scores[0].fit * 100)}%.` };
      }
      if (separated({ rails: scores }) && scores[0].known >= MIN_KNOWN) { stop = "best_found"; break; }
    }
    const field = live.filter((d) => !eliminated.has(d.id));
    const unknown = unknownCells(field.map((d) => d.id), needs, cells);
    if (unknown.length === 0) { stop = "complete"; break; }
    if (round > MAX_ROUNDS) { stop = "max_rounds"; break; }
    if (searches >= MAX_SEARCHES) { stop = "search_budget"; break; }
    rounds = round;

    const jobs = field.flatMap((d) => queriesFor(d, unknown.filter((u) => u.rail === d.id).map((u) => u.need)).map((q) => ({ def: d, q })));
    const jobsLeft = jobs.slice(0, MAX_SEARCHES - searches);
    yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: ${field.length} rail${field.length === 1 ? "" : "s"} still in the race, ${unknown.length} unanswered pairs`, state: "running", detail: `${jobsLeft.length} searches` };
    const tr = now();
    const fresh = new Map<string, FetchedPage[]>();

    const searchTask = (job: { def: RailDef; q: string }, n: number) => async function* (): AsyncGenerator<CEvent, void> {
      const pal = palIds.get(job.def.id)!;
      const id = `research-${job.def.id}-${round}`;
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
        const res = await s.run(job.q, signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_MS)]) : AbortSignal.timeout(SEARCH_MS));
        if (res.ok) {
          const ps = pagesFrom([{ id: s.id as "tavily" | "exa", data: res.data }], now());
          fresh.set(job.def.id, [...(fresh.get(job.def.id) ?? []), ...ps]);
          yield searchVisit(id, `${id}:s`, job.q, s.id as "tavily" | "exa", "ok", res.data.length);
          for (const w of res.data) yield readVisit(id, w.url, w.title, s.id as "tavily" | "exa");
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "ok", detail: `${ps.length} pages`, ms: now() - ts };
        } else {
          yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "error", detail: res.reason, ms: now() - ts };
        }
      } catch (e) {
        yield { kind: "step", agent: id, id: "search", label: `Searched ${s.label}`, state: "error", detail: e instanceof Error ? e.message : "failed", ms: now() - ts };
      }
      yield { kind: "agent", id, role: "research", title: "ResearchPal", state: "ok", ms: now() - ts, parent: pal };
    };

    yield* mergeStreams([...(round === 1 ? PROBED.map(probeTask) : []), ...jobsLeft.map((j, n) => searchTask(j, n + round))], PARALLEL);
    for (const [rail, ps] of fresh) {
      const have = pagesByRail.get(rail) ?? [];
      const urls = new Set(have.map((p) => p.url));
      pagesByRail.set(rail, [...have, ...ps.filter((p) => !urls.has(p.url))].slice(0, 6));
    }

    // 1. Classify from the search results first. A snippet that names the rail and quotes the support is enough, and it costs no page load.
    const classify = async function* (view: Map<string, FetchedPage[]>, label: string): AsyncGenerator<CEvent, { added: number; dropped: number; conflicting: number }> {
      const open = unknownCells(field.map((d) => d.id), needs, cells).filter((u) => view.has(u.rail));
      if (open.length === 0) return { added: 0, dropped: 0, conflicting: 0 };
      const out = yield* askMain(label, classifierMessages(idea, needs, open, view, live), (t) => parseCells(t).length > 0);
      const v = verifyCells(out ? parseCells(out) : [], pagesByRail, needs.map((n) => n.need), live);
      const m = mergeCellsDetail(cells, v.kept);
      const added = m.cells.length - cells.length;
      cells = m.cells;
      conflicts += m.conflicts.length;
      return { added, dropped: v.dropped.length, conflicting: m.conflicts.length };
    };
    let added = 0;
    if (fresh.size > 0) {
      const first = yield* classify(new Map([...fresh.keys()].map((r) => [r, pagesByRail.get(r) ?? []] as const)), `Round ${round}: reading what each rail supports`);
      added += first.added;
      yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: classified the search results`, state: "ok", detail: `${first.added} cited answers kept, ${first.dropped} dropped by cite-or-die${first.conflicting ? `, ${first.conflicting} conflicting` : ""}`, ms: now() - tr };
    } else {
      yield { kind: "step", agent, id: `round-${round}`, label: `Round ${round}: nothing came back`, state: "error", detail: "no pages", ms: now() - tr };
    }
    // 2. A page is opened ONLY when a rail is still blocked: it is in the race, it still has unanswered pairs after its snippets were read,
    // and it has a page we have not opened. A plain fetch goes first; the live browser (the user watches it) and then curl only when that is blocked or thin.
    const blockedRails = new Set(unknownCells(field.map((d) => d.id), needs, cells).map((u) => u.rail));
    const rank = new Map(scoreRails(live, needs, cells).map((s, i) => [s.rail, i] as const));
    const readJobs = field
      .filter((d) => blockedRails.has(d.id))
      .sort((x, y) => (rank.get(x.id) ?? 99) - (rank.get(y.id) ?? 99))
      .flatMap((d) => (pagesByRail.get(d.id) ?? []).filter((p) => !fullRead.has(p.url)).slice(0, 1).map((p) => ({ d, p })))
      .filter((j, i, all) => all.findIndex((x) => x.p.url === j.p.url) === i) // one URL is read once, however many rails list it
      .slice(0, MAX_READS_PER_ROUND);
    if (readJobs.length > 0) {
      yield { kind: "step", agent, id: `read-${round}`, label: `Round ${round}: ${readJobs.length} rail${readJobs.length === 1 ? " is" : "s are"} still blocked, opening ${readJobs.length === 1 ? "its best page" : "their best pages"}`, state: "running", detail: "the search results did not answer them" };
      const tread = now();
      const readTask = (job: (typeof readJobs)[number]) => async function* (): AsyncGenerator<CEvent, void> {
        fullRead.add(job.p.url);
        const r = yield* readPage({ ...ctx, agent: palIds.get(job.d.id)! }, job.p.url, { allowBrowser: true });
        if (!r) return;
        for (const [rail, ps] of pagesByRail) pagesByRail.set(rail, ps.map((x) => (x.url === job.p.url ? { ...x, text: r.text.slice(0, 3500) } : x)));
        readFull.set(job.p.url, r.via);
        if (readFull.size <= 12) yield* writeArtifact(ctx, `pages/${job.d.id}-${readFull.size}.md`, `# ${job.d.name}\n\nSource: ${r.url} (read by ${r.via})\n\n${r.text.slice(0, 3500)}\n`);
      };
      yield* mergeStreams(readJobs.map(readTask), 3);
      const opened = readJobs.filter((j) => readFull.has(j.p.url));
      yield { kind: "step", agent, id: `read-${round}`, label: `Round ${round}: opened ${opened.length} of ${readJobs.length} page${readJobs.length === 1 ? "" : "s"}`, state: opened.length > 0 ? "ok" : "error", detail: `${[...readFull.values()].filter((v) => v !== "fetch").length} needed the browser or terminal`, ms: now() - tread };
      if (opened.length > 0) {
        // every blocked rail that lists an opened page benefits from it (one URL can serve several rails), not only the rail that asked
        const openedUrls = new Set(opened.map((j) => j.p.url));
        const view = new Map([...blockedRails].map((r) => [r, pagesByRail.get(r) ?? []] as const).filter(([, ps]) => ps.some((x) => openedUrls.has(x.url))));
        const second = yield* classify(view, `Round ${round}: classifying the pages that were opened`);
        added += second.added;
        yield { kind: "step", agent, id: `round-${round}-deep`, label: `Round ${round}: classified the opened pages`, state: "ok", detail: `${second.added} more cited answers kept, ${second.dropped} dropped by cite-or-die${second.conflicting ? `, ${second.conflicting} conflicting` : ""}` };
      }
    }
    yield* writeArtifact(ctx, "situation-cells.csv", csvOf(["rail", "need", "support", "url", "quote"], cells.map((c) => [live.find((d) => d.id === c.rail)?.name ?? c.rail, c.need, c.support, c.url, c.quote])));
    yield* writeArtifact(ctx, "situation-sources.csv", csvOf(["rail", "url", "host", "found_by", "read_by", "characters"], [...pagesByRail].flatMap(([rail, ps]) => ps.map((p) => [rail, p.url, hostOfUrl(p.url), p.operator ?? "", readFull.get(p.url) ?? "snippet", p.text.length]))));
    if (added === 0 && round > 1) { stop = "no_progress"; break; }
    if (searches >= MAX_SEARCHES) { stop = "search_budget"; break; }
  }
  if (rounds === 0) for await (const _ of mergeStreams(PROBED.map(probeTask), PARALLEL)) void _;

  const finalScores = scoreRails(live, needs, cells);
  const best = separated({ rails: finalScores }) && finalScores[0].known >= MIN_KNOWN;
  const finalStop: StopReason = best ? "best_found" : unknownCells(live.map((d) => d.id), needs, cells).length === 0 ? "complete" : stop;
  const core = buildSituationCard({ idea, needs, needsDefaulted: parsed.length === 0, cells, probes, rounds, searches, stop: finalStop, railDefs: live, discovered, conflicts });

  // 6. blind check: a DIFFERENT model family sees only the typed grid
  yield { kind: "step", agent, id: "blind", label: "Blind check by a different model family", state: "running" };
  const tb = now();
  let blind: BlindResult | null = null;
  const others = { ...deps.model, models: deps.model.models.filter((m) => blindFamily !== null && familyOf(m.model) === blindFamily) };
  if (others.models.length > 0) {
    const r = yield* ask("Blind reader choosing from the grid", blindMessages(core), (t) => parseBlind(t, core) !== null, others);
    const b = r ? parseBlind(r.text, core) : null;
    if (r && b) blind = { family: r.family, pick: b.pick, concern: b.concern };
  }
  yield { kind: "step", agent, id: "blind", label: blind ? "Blind check by a different model family" : "Blind check could not run", state: blind ? "ok" : "error", detail: blind ? `a ${blind.family} model picked ${live.find((d) => d.id === blind!.pick)?.name ?? blind.pick}` : "no second model family answered", ms: now() - tb };

  // 7. rubric (pure) and receipt
  const rubric = judgeRecommendation(core, blind);
  const sealed = { ...core, rubric, ...(blind ? { blind } : {}) };
  const card = { ...sealed, receipt: { id: receiptId(sealed), cardHash: cardHash(sealed) } };
  yield { kind: "step", agent, id: "rubric", label: `Case Desk rubric: ${rubric.outcome}`, state: rubric.outcome === "APPROVE" ? "ok" : "error", detail: rubric.reasons.join(", ") };

  for (const d of live) {
    const id = palIds.get(d.id)!;
    const sc = card.rails.find((r) => r.rail === d.id)!;
    const mine = probes.filter((p) => p.rail === d.id);
    yield { kind: "agent", id, role: "superpal", title: `${d.name} Pal`, state: "ok", parent: agent, ms: now() - t0 };
    if (!eliminated.has(d.id)) yield { kind: "message", id: `from-${id}`, from: id, to: agent, text: `fit ${Math.round(sc.fit * 100)}%–${Math.round(sc.upper * 100)}%, ${sc.parts.filter((p) => p.support !== "unknown").length}/${sc.parts.length} needs cited${mine.length ? `; sandbox ${mine.filter((p) => p.outcome === "pass").length}/${mine.length} checks pass` : ""}.` };
  }
  yield* writeArtifact(ctx, "situation-probes.csv", csvOf(["rail", "check", "outcome", "detail"], probes.map((p) => [p.rail, p.check, p.outcome, p.detail])));
  yield* writeArtifact(ctx, "situation-report.md", `# ${idea.slice(0, 100)}\n\n${summarizeSituation(card)}\n`);
  yield { kind: "situation", agent, card };
  return summarizeSituation(card);
}
