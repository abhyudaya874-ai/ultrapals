import { clickElement, gotoUrl, openBrowser, scrollPage, snapshotPage, typeInto } from "@/lib/integrations/kbrowser";
import { execInVm, readFileInVm, serveInVm, writeFileInVm } from "@/lib/integrations/kterm";
import { fetchPageText } from "@/lib/integrations/webpage";
import { describeImages } from "@/lib/integrations/vision";
import { probePayPal, probeSquare, probeStripe } from "@/lib/integrations/rails";
import { approveOrderOnBrowser } from "@/lib/integrations/paypal-approve";
import { exaSearch } from "@/lib/integrations/exa";
import { paypal } from "@/lib/paypal";
import { tavilySearch } from "@/lib/integrations/tavily";
import { degrade } from "@/lib/integrations/registry";
import type { AdapterResult } from "@/lib/integrations/types";
import { research } from "@/lib/research/run";
import { createPromise, findPromises, promiseInfo, settlePromise } from "./promise-ops";
import type { CEvent } from "./events";
import { defaultModelDeps, type ModelDeps } from "./model";
import { getEnv, publicBase } from "@/lib/env";
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
  /** Public origin for links the model may emit (PUBLIC_URL tunnel or APP_URL). Lazy: env parses on first call. */
  appUrl: () => string;
  /** The money path, reachable ONLY through /api/promise ops — never computeVerdict, never a direct capture. */
  promise: { create: typeof createPromise; settle: typeof settlePromise; info: typeof promiseInfo; find: typeof findPromises };
  approveOrder: typeof approveOrderOnBrowser;
  /** Which SuperPal sandbox keys are present (never their values). Blank env -> {} so tests and builds never crash. */
  superKeys: () => Record<string, boolean>;
  orderStatus: (orderId: string) => Promise<AdapterResult<{ status: string }>>;
  /** Sandbox probes for SituationPal. PayPal's is read-only; Stripe and Square run against THEIR test environments only. */
  /** Reads one public page as text (SSRF-guarded). The reader falls back to the live browser and then the terminal when this fails. */
  fetchPage: typeof fetchPageText;
  /** Reads the user's attached pictures with a vision model and returns plain text. The planner never receives pixels. */
  vision: typeof describeImages;
  probes: { stripe: typeof probeStripe; square: typeof probeSquare; paypal: typeof probePayPal };
}

export const defaultDeps: Deps = {
  model: defaultModelDeps,
  appUrl: publicBase,
  vm: { open: openBrowser, snapshot: snapshotPage, goto: gotoUrl, click: clickElement, type: typeInto, scroll: scrollPage },
  term: { exec: execInVm, write: writeFileInVm, read: readFileInVm, serve: serveInVm },
  search: [{ id: "tavily", label: "Tavily", run: tavilySearch }, { id: "exa", label: "Exa", run: exaSearch }],
  research,
  promise: { create: createPromise, settle: settlePromise, info: promiseInfo, find: findPromises },
  approveOrder: approveOrderOnBrowser,
  superKeys: () => {
    try {
      const e = getEnv();
      return Object.fromEntries(["STRIPE_SANDBOX_KEY","SHOPIFY_SANDBOX_KEY","APPLE_SANDBOX_KEY","ADYEN_SANDBOX_KEY","WISE_SANDBOX_KEY","KLARNA_SANDBOX_KEY","SQUARE_SANDBOX_KEY","COINBASE_SANDBOX_KEY"].map((k) => [k, Boolean(e[k as keyof typeof e])]));
    } catch {
      return {};
    }
  },
  fetchPage: fetchPageText,
  vision: describeImages,
  probes: { stripe: probeStripe, square: probeSquare, paypal: probePayPal },
  orderStatus: async (orderId) => {
    const o = await paypal.getOrder(orderId, { signal: AbortSignal.timeout(8000) });
    return o.ok ? { ok: true, data: { status: o.orderStatus } } : degrade(`paypal order read: ${o.issue}`);
  },
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
  // Files written before the computer existed (the CSVs and notes of earlier research) are copied in, so TerminalPal can read them.
  for (const [path, content] of Object.entries(session.files)) {
    try {
      await deps.term.write(vm.id, `/workspace/${path}`, content);
    } catch {
      /* the session copy is the source of truth */
    }
  }
  return vm;
}
