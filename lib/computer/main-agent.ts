import type { InImage } from "@/lib/integrations/vision";
import { usedSources } from "@/lib/research/citations";
import { freshHandoff, handoffMessage, parseResume, pendingNote, resumeTask, type Handoff } from "@/lib/browse/handoff";
import { runBrowserAgent } from "./browser-agent";
import type { Deps, SubCtx } from "./ctx";
import type { AgentRole, Attachment, CEvent } from "./events";
import { MAIN_SYSTEM, mainPrompt, parseMainAction } from "./main-actions";
import { Spec, asksForSchedule, describeSchedule, parseSchedule } from "@/lib/automations/core";
import { runChart } from "./chart-action";
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

/** The `model` a run reports when the planner used every round without writing an answer. What the team found is shown, but the run did not conclude. */
export const NO_FINAL_ANSWER = "no final answer";
/** The `model` a run reports when it stopped for the person to act in the live browser. */
export const WAITING_FOR_YOU = "waiting for you";

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
  /** True once the run is short of time: the next planning round must be the answer, whatever budget of rounds is left. */
  hurry?: () => boolean;
  /** Run this delegation before the first planning round (the person typed an instruction into the live browser: skip deciding who should do it). */
  firstDelegate?: { agent: "browser"; task: string; /** The pause this continues, when the person has just helped. */ resumed?: Handoff };
  /** Steps the browser agent may take in this run. */
  browserSteps?: number;
  /** A person is watching: the browser agent may stop and ask them to act in the live browser (a CAPTCHA, a sign-in). Off for contenders and automations. */
  interactive?: boolean;
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

  /** Hands one task to a subagent, shows its row, and records what it found for the next planning round. Returns true when the subagent stopped for the person. */
  async function* delegate(agent: keyof typeof RUNNERS, task: string, resumed?: Handoff): AsyncGenerator<CEvent, boolean> {
    const before = session.handoff;
    const id = `${agent}-${++session.seq}`;
    const ts = Date.now();
    yield { kind: "message", id: `to-${id}`, from: "main", to: id, text: task };
    yield { kind: "agent", id, role: agent, title: TITLES[agent], state: "running" };
    const ctx: SubCtx = { agent: id, session, deps, signal, interactive: input.interactive, ...(resumed ? { resumed } : {}), ...(agent === "browser" && input.browserSteps ? { maxSteps: input.browserSteps } : {}) };
    let result: string;
    let failed = false;
    try {
      result = yield* RUNNERS[agent](ctx, task);
    } catch (e) {
      failed = true;
      result = `The ${agent} agent crashed: ${e instanceof Error ? e.message : "unknown error"}`;
    }
    yield { kind: "agent", id, role: agent, title: TITLES[agent], state: failed ? "error" : "ok", ms: Date.now() - ts };
    yield { kind: "message", id: `from-${id}`, from: id, to: "main", text: result.slice(0, 1200) };
    results.push({ agent, task, result });
    return !!session.handoff && session.handoff !== before;
  }

  /** The browser agent needs the person. The reply is fixed text, so it says the same thing every time: what to do, and that any message continues. */
  async function* waitForPerson(): AsyncGenerator<CEvent> {
    const text = handoffMessage(session.handoff!);
    session.history = pushHistory(pushHistory(session.history, { role: "user", content: input.prompt }), { role: "assistant", content: text });
    yield { kind: "answer", delta: text };
    yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "ok", ms: Date.now() - t0 };
    yield { kind: "done", used: [], model: WAITING_FOR_YOU, ms: Date.now() - t0 };
  }

  // If the browser agent stopped for the person last time, this message is their reply. "Continue" in any of its forms resumes the same task from
  // the page that is open now; anything else goes to the planner together with what was pending, so it can still choose to resume.
  let firstDelegate = input.firstDelegate;
  let pending = "";
  const waiting = freshHandoff(session.handoff, deps.model.now());
  session.handoff = undefined;
  if (waiting) {
    const reply = parseResume(input.prompt);
    if (reply.resume && !input.deny?.includes("browser")) firstDelegate = { agent: "browser", task: resumeTask(waiting, reply.extra), resumed: waiting };
    else if (!reply.resume) pending = pendingNote(waiting);
  }
  if (firstDelegate && !input.deny?.includes(firstDelegate.agent) && (yield* delegate(firstDelegate.agent, firstDelegate.task, firstDelegate.resumed))) {
    yield* waitForPerson();
    return;
  }

  for (let round = 1; round <= rounds; round++) {
    if (signal?.aborted) return;
    const messages = [
      { role: "system" as const, content: MAIN_SYSTEM },
      {
        role: "user" as const,
        content: mainPrompt({ prompt: input.prompt, path: input.path, appUrl: deps.appUrl(), pageContext: input.pageContext, selections: input.attachments.map((a) => a.text), history: session.history, results, sources: session.sources, mustAnswer: round === rounds || (input.hurry?.() ?? false) || (!!firstDelegate && round === 1), files: workspaceDigest(session.files), images: imageNotes, ...(pending ? { pending } : {}) }),
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
    if (a.action === "chart") {
      const result = yield* runChart({ agent: "main", session, deps, signal }, a.file, a.question);
      results.push({ agent: "chart", task: `chart ${a.file}`, result });
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
    if (yield* delegate(a.agent, a.task)) {
      yield* waitForPerson();
      return;
    }
  }

  // The rounds ran out and the planner still asked for more work instead of answering: end with what the team did find, not in silence.
  const found = [...results].reverse().find((r) => r.agent !== "system");
  const text = found ? `I ran out of planning steps before writing a full answer. This is what my team found:\n\n${found.result.slice(0, 1500)}` : "I could not produce an answer. Please try again.";
  session.history = pushHistory(pushHistory(session.history, { role: "user", content: input.prompt }), { role: "assistant", content: text });
  yield { kind: "answer", delta: text };
  yield { kind: "agent", id: "main", role: "main", title: PAL_NAMES.main, state: "ok", ms: Date.now() - t0 };
  yield { kind: "done", used: usedSources(text, session.sources.length), model: NO_FINAL_ANSWER, ms: Date.now() - t0 };
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
