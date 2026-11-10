import type { InImage } from "@/lib/integrations/vision";
import { usedSources } from "@/lib/research/citations";
import { runBrowserAgent } from "./browser-agent";
import type { Deps, SubCtx } from "./ctx";
import type { AgentRole, Attachment, CEvent } from "./events";
import { MAIN_SYSTEM, mainPrompt, parseMainAction } from "./main-actions";
import { Spec, asksForSchedule, describeSchedule, parseSchedule } from "@/lib/automations/core";
import { openAppArtifact } from "./app-open";
import { IMAGE_INSTRUCTION } from "./images";
import { answerTextSoFar } from "./json-text";
import { workspaceDigest } from "./artifacts";
import { callModel, type ModelResult } from "./model";
import { PAL_NAMES } from "./pals";
import { runPromiseAgent } from "./promise-agent";
import { runResearchAgent } from "./research-agent";
import { runRivalAgent } from "./rival-agent";
import { runSituationAgent } from "./situation-agent";
import { pushHistory, type Session } from "./session";
import { runTerminalAgent } from "./terminal-agent";

const MAX_ROUNDS = 6;
const MAX_ROUNDS_CAP = 10;

export interface MainInput {
  prompt: string;
  attachments: Attachment[];
  path: string;
  pageContext: string | null;
  /** Pictures the user attached (already resized by the browser). A vision model reads them; the planner only ever sees the text. */
  images?: InImage[];
  /** Planning rounds before UltraPal must answer (the model level sets it). Default 6. */
  maxRounds?: number;
  /** Delegates this run may not use (an unattended automation never gets PromisePal: nobody is there to approve money). */
  deny?: readonly string[];
  /** Minutes east of UTC where the user is, so "daily 09:00" means their 09:00. */
  tzOffsetMin?: number;
}

const RUNNERS = { research: runResearchAgent, browser: runBrowserAgent, terminal: runTerminalAgent, promise: runPromiseAgent, rival: runRivalAgent, situation: runSituationAgent } as const;
const TITLES: Record<Exclude<AgentRole, "main" | "superpal" | "sandbox">, string> = { research: PAL_NAMES.research, browser: PAL_NAMES.browser, terminal: PAL_NAMES.terminal, promise: PAL_NAMES.promise, rival: PAL_NAMES.rival, situation: PAL_NAMES.situation };

/**
 * The main agent: decides, delegates to subagents one at a time (they message it back), and writes the final answer.
 * Subagents only gather and act; the main agent is the only voice the user hears.
 */
export async function* runMain(session: Session, input: MainInput, deps: Deps, signal?: AbortSignal): AsyncGenerator<CEvent> {
  const t0 = Date.now();
  const results: { agent: string; task: string; result: string }[] = [];
  yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "running" };
  let invalid = 0;
  const opened = new Set<string>();
  const rounds = Math.max(2, Math.min(input.maxRounds ?? MAX_ROUNDS, MAX_ROUNDS_CAP));

  // Pictures: the planner is text-only, so a vision model reads them first and its description becomes data in the prompt.
  let imageNotes: string[] = [];
  if (input.images?.length) {
    const n = input.images.length;
    const label = `Reading ${n} image${n === 1 ? "" : "s"}`;
    yield { kind: "step", agent: "main", id: "main-img", label, state: "running" };
    const t = Date.now();
    const r = await deps.vision(input.images, IMAGE_INSTRUCTION, { signal });
    if (r.ok) {
      imageNotes = [`${input.images.map((i) => i.name).join(", ")}: ${r.data.text.slice(0, 3000)}`];
      yield { kind: "step", agent: "main", id: "main-img", label: `Read ${n} image${n === 1 ? "" : "s"}`, state: "ok", detail: r.data.model, ms: Date.now() - t };
    } else {
      imageNotes = [`(the user attached ${n} image${n === 1 ? "" : "s"} but they could not be read: ${r.reason}. Say so; do not guess what they show.)`];
      yield { kind: "step", agent: "main", id: "main-img", label, state: "error", detail: r.reason, ms: Date.now() - t };
    }
  }

  for (let round = 1; round <= rounds; round++) {
    if (signal?.aborted) return;
    const messages = [
      { role: "system" as const, content: MAIN_SYSTEM },
      {
        role: "user" as const,
        content: mainPrompt({ prompt: input.prompt, path: input.path, appUrl: deps.appUrl(), pageContext: input.pageContext, selections: input.attachments.map((a) => a.text), history: session.history, results, sources: session.sources, mustAnswer: round === rounds, files: workspaceDigest(session.files), images: imageNotes }),
      },
    ];
    // The final answer is streamed word by word as the model writes it (not dumped at the end); `streamed` is what the user already saw.
    let streamed = "";
    let res: ModelResult;
    const g = callModel("main", messages, deps.model, { signal, round, maxTokens: 1400, streamAnswer: answerTextSoFar });
    for (;;) {
      const n = await g.next();
      if (n.done) { res = n.value; break; }
      if (n.value.kind === "answer") streamed += n.value.delta;
      yield n.value;
    }
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
      if (a.text.startsWith(streamed)) {
        if (a.text.length > streamed.length) yield { kind: "answer", delta: a.text.slice(streamed.length) };
      } else if (streamed === "") yield { kind: "answer", delta: a.text };
      // else: the streamed prefix differs from the parsed text (an exotic escape); the user keeps what they saw rather than a duplicate
      yield { kind: "done", used, model: `${res.model} · ${res.provider}`, ms: Date.now() - t0 };
      return;
    }

    if (a.action === "open") {
      if (opened.has(a.artifact)) {
        results.push({ agent: "system", task: `open ${a.artifact}`, result: `The ${a.artifact} artifact is already open; its files are in the workspace.` });
        continue;
      }
      opened.add(a.artifact);
      const result = yield* openAppArtifact({ agent: "main", session, deps, signal }, a.artifact);
      results.push({ agent: "app", task: `open ${a.artifact}`, result });
      continue;
    }
    if (a.action === "automate") {
      const sid = `automate-${++session.seq}`;
      const result = yield* createAutomation(sid, a, input, deps);
      results.push({ agent: "system", task: `automate "${a.name}"`, result });
      continue;
    }
    if (input.deny?.includes(a.agent)) {
      results.push({ agent: "system", task: `delegate to ${a.agent}`, result: `${a.agent} is not available in this run. Use another agent or answer with what you have.` });
      continue;
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

/** UltraPal's `automate` action: validated in code, gated on the user's own words, then created through the same store as the Automations page. */
async function* createAutomation(id: string, a: { name: string; task: string; schedule: string }, input: MainInput, deps: Deps): AsyncGenerator<CEvent, string> {
  const label = `Creating automation "${a.name}"`;
  const refuse = function* (why: string, detail = why): Generator<CEvent, string> {
    yield { kind: "step", agent: "main", id, label, state: "error", detail };
    return why;
  };
  if (input.deny?.includes("automate")) return yield* refuse("Automations cannot be created from inside an automation.");
  if (!asksForSchedule(input.prompt)) return yield* refuse("The user's message does not ask for anything to repeat, so no automation was created. Answer or delegate instead; do not try again.", "the message did not ask for a schedule");
  const schedule = parseSchedule(a.schedule);
  if (!schedule) return yield* refuse(`The schedule "${a.schedule}" could not be read. Use "every 6 hours", "every 90 minutes", "hourly", "daily 09:00" or "weekdays 08:30". The shortest interval is 30 minutes.`, "unreadable schedule");
  const spec = Spec.safeParse({ name: a.name, prompt: a.task, schedule, tzOffsetMin: input.tzOffsetMin ?? 0, level: "standard" });
  if (!spec.success) return yield* refuse(`The automation was not valid: ${spec.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.`);
  yield { kind: "step", agent: "main", id, label, state: "running" };
  const r = await deps.automations.create(spec.data, deps.model.now());
  if (!r.ok) return yield* refuse(`The automation could not be created: ${r.reason}.`, r.reason);
  yield { kind: "step", agent: "main", id, label: `Created automation "${a.name}"`, state: "ok", detail: describeSchedule(schedule) };
  return `Created the automation "${a.name}" (${describeSchedule(schedule)}). It runs unattended and its results appear on the Automations page. Tell the user how often it runs and that they can pause or delete it there.`;
}
