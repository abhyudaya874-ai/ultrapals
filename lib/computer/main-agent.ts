import { usedSources } from "@/lib/research/citations";
import { runBrowserAgent } from "./browser-agent";
import type { Deps, SubCtx } from "./ctx";
import type { AgentRole, Attachment, CEvent } from "./events";
import { MAIN_SYSTEM, mainPrompt, parseMainAction } from "./main-actions";
import { callModel } from "./model";
import { PAL_NAMES } from "./pals";
import { runPromiseAgent } from "./promise-agent";
import { runResearchAgent } from "./research-agent";
import { runRivalAgent } from "./rival-agent";
import { pushHistory, type Session } from "./session";
import { runTerminalAgent } from "./terminal-agent";

const MAX_ROUNDS = 6;

export interface MainInput {
  prompt: string;
  attachments: Attachment[];
  path: string;
  pageContext: string | null;
}

const RUNNERS = { research: runResearchAgent, browser: runBrowserAgent, terminal: runTerminalAgent, promise: runPromiseAgent, rival: runRivalAgent } as const;
const TITLES: Record<Exclude<AgentRole, "main">, string> = { research: PAL_NAMES.research, browser: PAL_NAMES.browser, terminal: PAL_NAMES.terminal, promise: PAL_NAMES.promise, rival: PAL_NAMES.rival };

/**
 * The main agent: decides, delegates to subagents one at a time (they message it back), and writes the final answer.
 * Subagents only gather and act; the main agent is the only voice the user hears.
 */
export async function* runMain(session: Session, input: MainInput, deps: Deps, signal?: AbortSignal): AsyncGenerator<CEvent> {
  const t0 = Date.now();
  const results: { agent: string; task: string; result: string }[] = [];
  yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "running" };
  let invalid = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (signal?.aborted) return;
    const messages = [
      { role: "system" as const, content: MAIN_SYSTEM },
      {
        role: "user" as const,
        content: mainPrompt({ prompt: input.prompt, path: input.path, appUrl: deps.appUrl(), pageContext: input.pageContext, selections: input.attachments.map((a) => a.text), history: session.history, results, sources: session.sources, mustAnswer: round === MAX_ROUNDS }),
      },
    ];
    const res = yield* callModel("main", messages, deps.model, { signal, round, maxTokens: 1400 });
    if (!res.ok) {
      yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "error", ms: Date.now() - t0 };
      yield { kind: "error", message: res.error };
      return;
    }
    const parsed = parseMainAction(res.text);
    if (!parsed.ok) {
      results.push({ agent: "system", task: "format check", result: `Your last reply was rejected: ${parsed.error}. Reply with one JSON object.` });
      if (++invalid >= 3) {
        yield { kind: "error", message: "The model kept giving unusable replies." };
        return;
      }
      continue;
    }
    invalid = 0;
    const a = parsed.action;

    if (a.action === "answer") {
      const used = usedSources(a.text, session.sources.length);
      session.history = pushHistory(pushHistory(session.history, { role: "user", content: input.prompt }), { role: "assistant", content: a.text });
      yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "ok", ms: Date.now() - t0 };
      yield { kind: "answer", delta: a.text };
      yield { kind: "done", used, model: `${res.model} · ${res.provider}`, ms: Date.now() - t0 };
      return;
    }

    const id = `${a.agent}-${++session.seq}`;
    const ts = Date.now();
    yield { kind: "message", id: `to-${id}`, from: "main", to: id, text: a.task };
    yield { kind: "agent", id, role: a.agent, title: TITLES[a.agent], state: "running" };
    const ctx: SubCtx = { agent: id, session, deps, signal };
    let result: string;
    let failed = false;
    try {
      result = yield* RUNNERS[a.agent](ctx, a.task);
    } catch (e) {
      failed = true;
      result = `The ${a.agent} agent crashed: ${e instanceof Error ? e.message : "unknown error"}`;
    }
    yield { kind: "agent", id, role: a.agent, title: TITLES[a.agent], state: failed ? "error" : "ok", ms: Date.now() - ts };
    yield { kind: "message", id: `from-${id}`, from: id, to: "main", text: result.slice(0, 1200) };
    results.push({ agent: a.agent, task: a.task, result });
  }
}
