import { ensureVm, type SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModel } from "./model";
import { REPEAT_NOTE, repeatState } from "./repeat";
import { buildTermMessages, describeTerm, parseTermAction, type TermNote } from "./term-actions";

const MAX_STEPS = 14;
const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

/**
 * The terminal subagent: a shell in the session's cloud VM. It can run commands, write/read files and start servers
 * (which the browser agent can then open at http://localhost:<port> inside the same VM). Never touches this machine.
 */
export async function* runTerminalAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, deps } = ctx;
  const vm = yield* ensureVm(ctx);
  if (!vm) return "I could not start the cloud computer.";
  const notes: TermNote[] = [];
  const sigs: string[] = [];
  let invalid = 0;

  for (let n = 1; n <= MAX_STEPS; n++) {
    if (ctx.signal?.aborted) return "Cancelled.";
    const res = yield* callModel(agent, buildTermMessages(task, notes), deps.model, { signal: ctx.signal, round: n, maxTokens: 2400 });
    if (!res.ok) return `I could not decide the next step: ${res.error}`;
    const parsed = parseTermAction(res.text);
    if (!parsed.ok) {
      notes.push({ step: n, did: "(unusable reply)", result: parsed.error });
      if (++invalid >= 3) return "The model kept giving unusable replies, so I stopped.";
      continue;
    }
    invalid = 0;
    const a = parsed.action;
    const id = `${agent}-s${n}`;
    const label = describeTerm(a);
    if (a.action === "finish") {
      yield { kind: "step", agent, id, label, state: "ok" };
      return a.summary;
    }
    const sig = JSON.stringify(a);
    const rep = repeatState(sigs, sig);
    sigs.push(sig);
    if (rep === "stuck") return `I kept repeating "${label}" without progress. Recent: ${notes.slice(-2).map((x) => `${x.did} => ${x.result.slice(0, 160).replace(/\n/g, " ")}`).join(" | ")}`;
    yield { kind: "step", agent, id, label, state: "running" };
    const t0 = Date.now();
    let error: string | null = null;
    let result = "";
    if (rep === "again") {
      yield { kind: "step", agent, id, label, state: "error", detail: "repeated", ms: 0 };
      notes.push({ step: n, did: label, result: REPEAT_NOTE });
      continue;
    }

    switch (a.action) {
      case "run":
      case "serve": {
        const command = a.command;
        yield { kind: "term", agent, id, command: a.action === "serve" ? `${command}   # serve :${a.port}` : command, state: "running" };
        const r = a.action === "run" ? await deps.term.exec(vm.id, command, a.timeout ?? 90) : await deps.term.serve(vm.id, command, a.port);
        if (!r.ok) {
          error = r.reason;
          yield { kind: "term", agent, id, command, state: "error", out: r.reason, ms: Date.now() - t0 };
        } else {
          const bad = r.data.exit !== 0;
          if (bad) error = `exit ${r.data.exit}`;
          yield { kind: "term", agent, id, command, state: bad ? "error" : "ok", out: r.data.out, exit: r.data.exit, ms: r.data.ms || Date.now() - t0 };
          result = `exit ${r.data.exit}\n${tail(r.data.out, 1500)}`;
        }
        break;
      }
      case "write": {
        const r = await deps.term.write(vm.id, a.path, a.content);
        if (!r.ok) error = r.reason;
        else {
          result = `${r.data.created ? "created" : "updated"} ${r.data.path} (+${r.data.adds} -${r.data.removes})`;
          yield { kind: "file", agent, id, path: r.data.path, created: r.data.created, adds: r.data.adds, removes: r.data.removes, preview: a.content.slice(0, 4000) };
        }
        break;
      }
      case "read": {
        const r = await deps.term.read(vm.id, a.path);
        if (!r.ok) error = r.reason;
        else result = tail(r.data, 1500);
        break;
      }
    }
    yield { kind: "step", agent, id, label, state: error ? "error" : "ok", detail: error ?? undefined, ms: Date.now() - t0 };
    notes.push({ step: n, did: label, result: error && !result ? `ERROR: ${error}` : result });
  }
  return `I used all ${MAX_STEPS} steps without finishing. Recent: ${notes.slice(-3).map((x) => `${x.did} => ${x.result.slice(0, 80).replace(/\n/g, " ")}`).join(" | ")}`;
}
