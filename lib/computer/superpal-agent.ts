import { pickEvidence } from "@/lib/pals/evidence";
import { pagesFrom } from "@/lib/pals/generate";
import type { SuperPalRow } from "@/lib/pals/superpals";
import { mergeStreams } from "@/lib/swarm/tree/merge";
import { admitSpawn } from "@/lib/swarm/tree/policy";
import { SPAWNS, jobKey, type Caps, type SpawnRequest, type TreeNode } from "@/lib/swarm/tree/types";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";

const SEARCH_MS = 9_000;
const PARALLEL = 4;
const WINDOW_MS = 60_000;

const ROOT_CAPS: Caps = { spawn: SPAWNS.root, tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS };
const PAL_CAPS: Caps = { spawn: SPAWNS.pal, tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS };
const WORKER_CAPS: Caps = { spawn: [], tools: ["tavily", "exa"], maxCalls: 0, maxMs: WINDOW_MS };

const req = (kind: "pal" | "research", task: string, why: string, input: Record<string, unknown>): SpawnRequest => ({ kind, mode: "script", task, why, input, ask: { calls: 0, ms: SEARCH_MS }, expects: "sources" });

/**
 * RivalPal's SuperPals each get their own ResearchPal: main -> RivalPal -> SuperPal -> ResearchPal. Every hop is admitted by the pure
 * spawn policy, and the workers are scripts (one Tavily or Exa search, 0 model calls). A worker returns a cited line about its rival
 * (a verbatim quote, the fetcher's time and operator). The evidence is context: it never changes a row's status or the seal.
 */
export async function* runSuperPals(ctx: SubCtx, rows: SuperPalRow[], now: () => number = Date.now): AsyncGenerator<CEvent, SuperPalRow[]> {
  const { agent, deps, signal } = ctx;
  const searchers = deps.search.filter((s) => s.id === "tavily" || s.id === "exa");
  if (searchers.length === 0 || rows.length === 0) return rows;

  const t0 = now();
  const nodes: TreeNode[] = [{ id: agent, parent: null, kind: "root", mode: "script", key: `root:${agent}`, depth: 0, caps: ROOT_CAPS, callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" }];
  const add = (n: Omit<TreeNode, "deadlineMs" | "callsLeft" | "state">): void => void nodes.push({ ...n, callsLeft: 0, deadlineMs: t0 + WINDOW_MS, state: "live" });
  const setState = (id: string, state: TreeNode["state"]): void => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) nodes[i] = { ...nodes[i], state };
  };
  const out = new Map<string, SuperPalRow>();

  const tasks = rows.map((row, idx) => async function* (): AsyncGenerator<CEvent, void> {
    const palId = `superpal-${row.pal.id}`;
    const workerId = `research-sp-${row.pal.id}`;
    const palReq = req("pal", `${row.pal.name} reads ${row.pal.company}'s published docs`, `${row.pal.keyEnv} is not a sandbox we can use yet; published pages are the measurable evidence`, { pal: row.pal.id });
    const d = admitSpawn({ nodes }, agent, palReq, now());
    if (!d.ok) {
      yield { kind: "spawn", parent: agent, child: palId, why: palReq.why, decision: "denied", detail: d.why };
      return;
    }
    yield { kind: "spawn", parent: agent, child: palId, why: palReq.why, decision: d.reuse ? "reused" : "admitted" };
    add({ id: palId, parent: agent, kind: "pal", mode: "script", key: jobKey(palReq), depth: 1, caps: PAL_CAPS });
    const ts = now();
    yield { kind: "message", id: `to-${palId}`, from: agent, to: palId, text: `Find what ${row.pal.company} publishes about: ${row.pal.edge}.` };
    yield { kind: "agent", id: palId, role: "superpal", title: row.pal.name, state: "running", parent: agent };

    const wReq = req("research", `${row.pal.company} ${row.pal.edge}`, "a cited line beats an opinion about a rival", { q: `${row.pal.company} ${row.pal.edge}` });
    const wd = admitSpawn({ nodes }, palId, wReq, now());
    let row2: SuperPalRow = row;
    if (!wd.ok) {
      yield { kind: "spawn", parent: palId, child: workerId, why: wReq.why, decision: "denied", detail: wd.why };
    } else {
      yield { kind: "spawn", parent: palId, child: workerId, why: wReq.why, decision: wd.reuse ? "reused" : "admitted" };
      add({ id: workerId, parent: palId, kind: "research", mode: "script", key: jobKey(wReq), depth: 2, caps: WORKER_CAPS });
      yield { kind: "agent", id: workerId, role: "research", title: "ResearchPal", state: "running", parent: palId };
      const s = searchers[idx % searchers.length];
      const tw = now();
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_MS)]) : AbortSignal.timeout(SEARCH_MS);
      yield { kind: "step", agent: workerId, id: "search", label: `Searching ${s.label} for ${row.pal.company}`, state: "running" };
      let found = false;
      try {
        const r = await s.run(String(wReq.input.q), sig);
        if (r.ok) {
          const ev = pickEvidence(row.pal.company, pagesFrom([{ id: s.id as "tavily" | "exa", data: r.data }], now()));
          if (ev) {
            row2 = { ...row, evidence: ev };
            found = true;
          }
          yield { kind: "step", agent: workerId, id: "search", label: `Searched ${s.label} for ${row.pal.company}`, state: "ok", detail: found ? "1 cited line" : "no page named them", ms: now() - tw };
        } else {
          yield { kind: "step", agent: workerId, id: "search", label: `Searched ${s.label} for ${row.pal.company}`, state: "error", detail: r.reason, ms: now() - tw };
        }
      } catch (e) {
        yield { kind: "step", agent: workerId, id: "search", label: `Searched ${s.label} for ${row.pal.company}`, state: "error", detail: e instanceof Error ? e.message : "failed", ms: now() - tw };
      }
      setState(workerId, found ? "done" : "failed");
      yield { kind: "agent", id: workerId, role: "research", title: "ResearchPal", state: found ? "ok" : "error", ms: now() - tw, parent: palId };
    }
    setState(palId, "done");
    out.set(row.pal.id, row2);
    yield { kind: "agent", id: palId, role: "superpal", title: row.pal.name, state: "ok", ms: now() - ts, parent: agent };
    yield { kind: "message", id: `from-${palId}`, from: palId, to: agent, text: row2.evidence ? `${row.pal.company}: "${row2.evidence.quote}" (${row2.evidence.url})` : `No fetched page named ${row.pal.company}; ${row.pal.name} reports no published evidence.` };
  });

  yield* mergeStreams(tasks, PARALLEL);
  return rows.map((r) => out.get(r.pal.id) ?? r);
}
