import type { ChatMessage } from "@/lib/integrations/chat";
import { buildCard, summarizeCard } from "@/lib/pals/card";
import { runExam } from "@/lib/pals/exam";
import { generateRivals, type GenDeps } from "@/lib/pals/generate";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModel } from "./model";

/**
 * RivalPal: researches how THIS deal fails (Tavily + Exa), spawns cited rivals, attacks the real judge with their hostile worlds,
 * and reports a ladder. It gathers and examines; it never decides a verdict and never touches money.
 */
export async function* runRivalAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, deps, signal } = ctx;
  let round = 0;
  const ask: GenDeps["ask"] = async (messages: ChatMessage[], sig) => {
    const g = callModel(agent, messages, deps.model, { signal: sig ?? signal, round: round++, maxTokens: 1800 });
    for (;;) {
      const n = await g.next();
      if (n.done) return n.value.ok ? n.value.text : null;
    }
  };
  const search: GenDeps["search"] = [];
  for (const s of deps.search) if (s.id === "tavily" || s.id === "exa") search.push({ id: s.id, run: s.run });

  const gen = generateRivals(task, { search, ask, now: Date.now }, signal);
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      const res = n.value;
      if (res.entries.length === 0) return `Rival exam could not run: ${res.error ?? "no rivals"}. Do not claim the deal was examined.`;
      const t0 = Date.now();
      yield { kind: "step", agent, id: "exam", label: "Attacking the judge with the rivals' hostile worlds", state: "running" };
      const exam = runExam(res.entries.map((e) => e.rival));
      const card = buildCard(task, res, exam);
      yield { kind: "step", agent, id: "exam", label: "Attacked the judge with the rivals' hostile worlds", state: "ok", detail: `${exam.attacks.run.length} attacks, ${exam.seal.seal}`, ms: Date.now() - t0 };
      yield { kind: "ladder", agent, card };
      return summarizeCard(card);
    }
    yield { kind: "step", agent, ...n.value };
  }
}
