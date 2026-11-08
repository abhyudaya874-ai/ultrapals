import { describeAction, parseAction } from "@/lib/browse/actions";
import { buildBrowseMessages, type StepNote } from "@/lib/browse/snapshot";
import { mergeSources } from "@/lib/research/sources";
import { ensureVm, type SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModel } from "./model";
import { REPEAT_NOTE, repeatState } from "./repeat";
import { mergeInto } from "./session";

const MAX_STEPS = 10;
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u) || u.startsWith("about:");

/**
 * The browser subagent: look at the page, ask a free model for ONE action, perform it with the visible cursor, repeat.
 * Returns its findings as text (with [n] citations into the session's shared source list) for the main agent.
 */
export async function* runBrowserAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, session, deps } = ctx;
  const vm = yield* ensureVm(ctx);
  if (!vm) return "I could not start the browser.";
  const notes: StepNote[] = [];
  const sigs: string[] = [];
  let lastUrl = "";
  let invalid = 0;

  for (let n = 1; n <= MAX_STEPS; n++) {
    if (ctx.signal?.aborted) return "Cancelled.";
    const snap = await deps.vm.snapshot(vm);
    if (!snap.ok) return `The browser failed: ${snap.reason}`;
    const s = snap.data;
    if (s.url !== lastUrl) {
      lastUrl = s.url;
      yield { kind: "page", url: s.url, title: s.title };
      if (!isLocal(s.url)) {
        const m = mergeInto(session.sources, [{ url: s.url, title: s.title || s.url, snippet: s.text.slice(0, 500) || s.title, publishedDate: null, provider: "browser", score: null }]);
        if (m.sources.length !== session.sources.length) {
          session.sources = m.sources;
          yield { kind: "sources", sources: m.sources };
        }
      }
    }

    const res = yield* callModel(agent, buildBrowseMessages(task, s, notes, session.sources), deps.model, { signal: ctx.signal, round: n, maxTokens: 700 });
    if (!res.ok) return `I could not decide the next step: ${res.error}`;
    const parsed = parseAction(res.text);
    if (!parsed.ok) {
      notes.push({ step: n, did: "(unusable reply)", result: parsed.error });
      if (++invalid >= 3) return "The model kept giving unusable replies, so I stopped.";
      continue;
    }
    invalid = 0;
    const a = parsed.action;
    const el = a.action === "click" || a.action === "type" ? s.elements.find((e) => e.i === a.index) : undefined;
    const id = `${agent}-s${n}`;
    const label = describeAction(a, el?.label.slice(0, 40));
    if (a.action === "finish") {
      yield { kind: "step", agent, id, label, state: "ok" };
      return a.answer;
    }
    const sig = `${s.url}|${JSON.stringify(a)}`;
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
      case "goto":
        error = fail(await deps.vm.goto(vm, a.url));
        break;
      case "click":
        error = el ? fail(await deps.vm.click(vm, el)) : `no element [${a.index}] on this page`;
        break;
      case "type":
        error = el ? fail(await deps.vm.type(vm, el, a.text, a.submit ?? false)) : `no element [${a.index}] on this page`;
        break;
      case "scroll":
        error = fail(await deps.vm.scroll(vm, a.direction));
        break;
      case "read":
        result = s.text.length > 1800 ? s.text.slice(1800, 3300) : "(the whole page text is already shown above)";
        break;
      case "pay":
        error = "payments are not available to the browser agent; ask the main agent to use the promise agent";
        break;
    }
    yield { kind: "step", agent, id, label, state: error ? "error" : "ok", detail: error ?? undefined, ms: Date.now() - t0 };
    notes.push({ step: n, did: label, result: (error ? `ERROR: ${error}` : result).slice(0, 400) });
  }
  return `I used all ${MAX_STEPS} steps without finishing. Last page: ${lastUrl || "none"}. Notes: ${notes.slice(-3).map((x) => `${x.did} => ${x.result.slice(0, 80)}`).join(" | ")}`;
}
