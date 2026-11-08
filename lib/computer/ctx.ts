import { clickElement, gotoUrl, openBrowser, scrollPage, snapshotPage, typeInto } from "@/lib/integrations/kbrowser";
import { execInVm, readFileInVm, serveInVm, writeFileInVm } from "@/lib/integrations/kterm";
import { exaSearch } from "@/lib/integrations/exa";
import { tavilySearch } from "@/lib/integrations/tavily";
import { research } from "@/lib/research/run";
import type { CEvent } from "./events";
import { defaultModelDeps, type ModelDeps } from "./model";
import type { Session } from "./session";

/** Everything an agent touches the outside world through. Tests pass fakes; production passes defaultDeps. */
export interface Deps {
  model: ModelDeps;
  vm: {
    open: typeof openBrowser;
    snapshot: typeof snapshotPage;
    goto: typeof gotoUrl;
    click: typeof clickElement;
    type: typeof typeInto;
    scroll: typeof scrollPage;
  };
  term: { exec: typeof execInVm; write: typeof writeFileInVm; read: typeof readFileInVm; serve: typeof serveInVm };
  search: { id: string; label: string; run: typeof tavilySearch }[];
  research: typeof research;
}

export const defaultDeps: Deps = {
  model: defaultModelDeps,
  vm: { open: openBrowser, snapshot: snapshotPage, goto: gotoUrl, click: clickElement, type: typeInto, scroll: scrollPage },
  term: { exec: execInVm, write: writeFileInVm, read: readFileInVm, serve: serveInVm },
  search: [{ id: "tavily", label: "Tavily", run: tavilySearch }, { id: "exa", label: "Exa", run: exaSearch }],
  research,
};

export interface SubCtx {
  agent: string; // e.g. "browser-1"
  session: Session;
  deps: Deps;
  signal?: AbortSignal;
}

/**
 * The VM is opened once per session, on first need (3-20s on KERNEL), and shared by the browser and terminal agents.
 * Only the agent that actually opens it announces the live view; a concurrent agent just waits for the same promise.
 */
export async function* ensureVm(ctx: SubCtx): AsyncGenerator<CEvent, NonNullable<Session["vm"]> | null> {
  const { session, deps, agent } = ctx;
  if (session.vm) return session.vm;
  if (session.vmOpening) return session.vmOpening;
  const id = `${agent}-vm`;
  yield { kind: "step", agent, id, label: "Starting a cloud computer", state: "running" };
  const t0 = Date.now();
  session.vmOpening = deps.vm.open(ctx.signal).then((r) => (r.ok ? (session.vm = r.data) : null));
  const vm = await session.vmOpening;
  session.vmOpening = null;
  if (!vm) {
    yield { kind: "step", agent, id, label: "Starting a cloud computer", state: "error", detail: "could not start (is KERNEL on?)", ms: Date.now() - t0 };
    return null;
  }
  yield { kind: "step", agent, id, label: "Started a cloud computer", state: "ok", ms: Date.now() - t0 };
  yield { kind: "workspace", liveViewUrl: vm.liveViewUrl };
  return vm;
}
