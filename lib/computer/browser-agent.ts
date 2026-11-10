import { describeAction, parseAction } from "@/lib/browse/actions";
import { needsHuman, noticeFor, sameAsk, sameSpot, type HumanNeed } from "@/lib/browse/handoff";
import { buildBrowseMessages, changeNote, memoryText, type Snapshot, type StepNote } from "@/lib/browse/snapshot";
import { mergeSources } from "@/lib/research/sources";
import { ensureVm, type SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModelHedged } from "./model";
import { browsingDeps } from "./models";
import { REPEAT_NOTE, repeatState } from "./repeat";
import { mergeInto } from "./session";

/** Steps a delegated browsing task may take. A task the person types into the browser's own box gets more (see `SubCtx.maxSteps`). */
export const MAX_STEPS = 12;
export const USER_TASK_STEPS = 20;
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u) || u.startsWith("about:") || u.startsWith("chrome-error:");

/**
 * The browser subagent: look at the page, ask a free model for ONE action, perform it with the visible cursor, repeat.
 * After every action the next look says what changed (a new page, a scroll, nothing), so the model can tell whether it worked.
 * Returns its findings as text (with [n] citations into the session's shared source list) for the main agent.
 */
export async function* runBrowserAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, session, deps } = ctx;
  const maxSteps = ctx.maxSteps ?? MAX_STEPS;
  const vm = yield* ensureVm(ctx);
  if (!vm) return "I could not start the browser.";
  const resumed = ctx.resumed;
  /** A continued run starts with the history of the run it continues, so to the model it is one task and not a new one. */
  const notes: StepNote[] = resumed ? resumed.notes.map((did) => ({ step: 0, did, result: "done before the pause" })) : [];
  /** What the model wrote down from earlier pages. The page text is replaced every step; this is what lets a task span several pages. */
  const memory: string[] = [];
  /** Pages visited before the pause. Opening one of them again is almost always the model starting over, so it is questioned once. */
  const before = new Set((resumed?.visited ?? []).map(sameSpot));
  const reopened = new Set<string>();
  const seen: string[] = [...(resumed?.visited ?? [])];
  const sigs: string[] = [];
  let lastUrl = "";
  let invalid = 0;
  let prev: Snapshot | null = null;
  let lastDid = "";
  let waitedAt = "";
  const modelDeps = browsingDeps(deps.model);

  /**
   * Stops and asks the person to act in the live browser. The reason, the task and what was already done are kept on the conversation, so a
   * plain "continue" later picks up from the page that is open. A run nobody is watching (a contender, an automation) cannot ask: it reports the wall.
   */
  async function* askPerson(reason: string, need: HumanNeed["kind"] | "asked", n: number): AsyncGenerator<CEvent, string> {
    if (!ctx.interactive) return `Blocked: ${reason} Nobody is available to help in this run, so the task cannot be finished here. Page: ${lastUrl || "unknown"}.`;
    const done = notes.filter((x) => !/^ERROR|unusable/.test(x.result) && !x.did.startsWith("(")).slice(-8).map((x) => x.did);
    session.handoff = { agent: "browser", task, reason, kind: need, url: lastUrl, notes: done, visited: seen.slice(-12), ...(memory.length ? { found: memoryText(memory, 900) } : {}), at: deps.model.now() };
    yield { kind: "step", agent, id: `${agent}-h${n}`, label: "Waiting for you", state: "ok", detail: reason };
    yield { kind: "handoff", agent, reason, need, url: lastUrl };
    return `NEEDS_HUMAN: ${reason}`;
  }

  for (let n = 1; n <= maxSteps; n++) {
    if (ctx.signal?.aborted) return "Cancelled.";
    let snap = await deps.vm.snapshot(vm);
    if (!snap.ok) return `The browser failed: ${snap.reason}`;
    // A page that has loaded nothing yet (a script-built page) shows an empty view; acting on it wastes a step. Give it a moment, once per address.
    if (snap.data.text.trim().length < 60 && snap.data.elements.length === 0 && /^https?:/i.test(snap.data.url) && waitedAt !== snap.data.url) {
      waitedAt = snap.data.url;
      yield { kind: "step", agent, id: `${agent}-w${n}`, label: "Waiting for the page to load", state: "running" };
      await deps.vm.wait(vm, 3);
      const again = await deps.vm.snapshot(vm);
      if (again.ok) snap = again;
      yield { kind: "step", agent, id: `${agent}-w${n}`, label: "Waiting for the page to load", state: "ok" };
    }
    const s = snap.data;
    // what the last action did, so the model reads the result of its own move
    const changed = changeNote(prev, s);
    if (lastDid && changed && notes.length) notes[notes.length - 1] = { ...notes[notes.length - 1], result: `${notes[notes.length - 1].result}; ${changed}`.slice(0, 400) };
    prev = s;
    if (n === 1 && resumed) {
      // The person has been in the browser. Say where it is now against where the run stopped, so the model carries on from the page in front of it.
      const there = sameSpot(s.url) === sameSpot(resumed.url) ? "it is still on the page you stopped at" : `it is now on ${s.url}${s.title ? ` ("${s.title.slice(0, 50)}")` : ""}; you stopped at ${resumed.url || "a blank page"}`;
      notes.push({ step: 0, did: "(the person used the browser while you waited)", result: there });
    }
    if (s.url !== lastUrl) {
      lastUrl = s.url;
      if (!seen.includes(s.url)) seen.push(s.url);
      yield { kind: "page", url: s.url, title: s.title };
      if (!isLocal(s.url)) {
        const m = mergeInto(session.sources, [{ url: s.url, title: s.title || s.url, snippet: s.text.slice(0, 500) || s.title, publishedDate: null, provider: "browser", score: null }]);
        if (m.sources.length !== session.sources.length) {
          session.sources = m.sources;
          yield { kind: "sources", sources: m.sources };
        }
      }
    }

    // A CAPTCHA or a block page is a wall made to stop programs: do not spend a model call on it, ask the person. A sign-in form is only a hint.
    const need = needsHuman(s);
    if (need?.stop) return yield* askPerson(need.reason, need.kind, n);

    // The first model to give a usable action wins; a reply that is not one moves on to the next model at once instead of costing a step.
    const res = yield* callModelHedged(agent, buildBrowseMessages(task, s, notes, session.sources, [], noticeFor(need), memoryText(memory)), modelDeps, { signal: ctx.signal, round: n, maxTokens: 700, accept: (t) => parseAction(t).ok });
    // No model answered at all: report it. Models answered but none with an action: say so to the next try, a few times at most.
    if (!res.ok && res.rejected === undefined) return `I could not decide the next step: ${res.error}`;
    const parsed = parseAction(res.ok ? res.text : (res.rejected ?? ""));
    if (!parsed.ok) {
      notes.push({ step: n, did: "(unusable reply)", result: parsed.error });
      lastDid = "";
      if (++invalid >= 3) return "The model kept giving unusable replies, so I stopped.";
      continue;
    }
    invalid = 0;
    const a = parsed.action;
    if (parsed.note) memory.push(parsed.note);
    const el = a.action === "click" || a.action === "type" || a.action === "select" ? s.elements.find((e) => e.i === a.index) : undefined;
    const id = `${agent}-s${n}`;
    const label = describeAction(a, el?.label.slice(0, 40));
    if (a.action === "finish") {
      yield { kind: "step", agent, id, label, state: "ok" };
      return a.answer;
    }
    if (a.action === "handoff") {
      // Asking for the help the person has only just given is a loop, usually because the task's own words say to ask. Tell the model and let it carry on.
      if (resumed && sameAsk(a.reason, resumed.reason)) {
        yield { kind: "step", agent, id, label, state: "error", detail: "already helped", ms: 0 };
        notes.push({ step: n, did: label, result: "ERROR: the person has already done this; do not ask again. Carry on with the task from the page that is open.", thought: parsed.thought });
        lastDid = "";
        continue;
      }
      return yield* askPerson(a.reason, "asked", n);
    }
    // where on the page counts: scrolling down twice is two different moves
    const sig = `${s.url}|${s.scroll?.y ?? 0}|${JSON.stringify(a)}`;
    const rep = repeatState(sigs, sig);
    sigs.push(sig);
    if (rep === "stuck") return `I kept repeating "${label}" without progress. Page ${s.url} says: ${s.text.replace(/\s+/g, " ").slice(0, 600)}`;
    yield { kind: "step", agent, id, label, state: "running" };
    const t0 = Date.now();
    let error: string | null = null;
    let result = "done";
    if (rep === "again") {
      yield { kind: "step", agent, id, label, state: "error", detail: "repeated", ms: 0 };
      notes.push({ step: n, did: label, result: REPEAT_NOTE });
      lastDid = "";
      continue;
    }
    const fail = (r: { ok: boolean; reason?: string }) => (r.ok ? null : (r.reason ?? "failed"));

    switch (a.action) {
      case "search": {
        const found = await Promise.all(deps.search.map((x) => x.run(a.query, ctx.signal)));
        const top = mergeSources(found.flatMap((r) => (r.ok ? [r.data] : [])), 6);
        if (top.length === 0) error = "no results";
        else {
          const m = mergeInto(session.sources, top);
          session.sources = m.sources;
          yield { kind: "sources", sources: m.sources };
          result = top.map((t, i) => `[${m.map[i]}] ${t.title} (${t.host}) ${t.url}`).join("\n");
        }
        break;
      }
      case "goto": {
        const spot = sameSpot(a.url);
        if (before.has(spot) && !reopened.has(spot) && sameSpot(s.url) !== spot) {
          // Going back to where the task began, after the person has moved the browser on, is the model restarting. Ask it once; if it insists, let it.
          reopened.add(spot);
          error = `you already opened ${a.url} before the pause, and the browser has since moved on to ${s.url}. Carry on from the page that is open now; open that address again only if you really need it.`;
          break;
        }
        error = fail(await deps.vm.goto(vm, a.url));
        break;
      }
      case "click":
        error = el ? fail(await deps.vm.click(vm, el)) : `no element [${a.index}] on this page`;
        break;
      case "type":
        error = el ? fail(await deps.vm.type(vm, el, a.text, a.submit ?? false)) : `no element [${a.index}] on this page`;
        break;
      case "select":
        error = el ? fail(await deps.vm.select(vm, el, a.option)) : `no element [${a.index}] on this page`;
        break;
      case "scroll":
        error = fail(await deps.vm.scroll(vm, a.direction, a.to));
        break;
      case "key":
        error = fail(await deps.vm.key(vm, a.key));
        break;
      case "back":
      case "forward":
      case "reload":
        error = fail(await deps.vm.navigate(vm, a.action));
        break;
      case "wait":
        error = fail(await deps.vm.wait(vm, a.seconds));
        break;
      case "find": {
        const f = await deps.vm.find(vm, a.text);
        if (!f.ok) error = f.reason;
        else if (!f.data.found) error = `"${a.text}" is not on this page`;
        else result = `found it: ${f.data.context || "(no surrounding text)"}`;
        break;
      }
      case "read":
        result = s.text.length > 1800 ? s.text.slice(1800, 3300) : "(the whole page text is already shown above)";
        break;
      case "pay":
        error = "payments are not available to the browser agent; ask the main agent to use the promise agent";
        break;
    }
    yield { kind: "step", agent, id, label, state: error ? "error" : "ok", detail: error ?? undefined, ms: Date.now() - t0 };
    notes.push({ step: n, did: label, result: (error ? `ERROR: ${error}` : result).slice(0, 400), thought: parsed.thought });
    lastDid = label;
  }
  return `I used all ${maxSteps} steps without finishing. Last page: ${lastUrl || "none"}. Notes: ${notes.slice(-3).map((x) => `${x.did} => ${x.result.slice(0, 80)}`).join(" | ")}`;
}
