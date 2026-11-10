import { describe, expect, it } from "vitest";
import type { openChat } from "@/lib/integrations/chat";
import type { CEvent } from "@/lib/computer/events";
import { collect, mkDeps, mkSession, stream } from "@/lib/computer/fakes";
import { applyCEvent, newRun } from "@/lib/computer/run";
import { defaultPlan } from "./plan";
import { runArena, type ArenaDeps } from "./run";

const sse = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
// How good the blind judge finds each persona or scenario. The judge never sees persona names (they are scrubbed to "the analyst"), so a report
// carries its skill as a token, [S9], that the fake judge reads.
const SKILL: Record<string, number> = { Maximalist: 7, Skeptic: 5, Pragmatist: 9, "Risk officer": 6, Rigorist: 8, "Base case": 5, "Worst realistic case": 7, "Half the budget": 9, "Hostile counterpart": 6 };
const skillOf = (who: string, variation: string): number => SKILL[variation] ?? SKILL[who] ?? 4;
const skillIn = (text: string): number => Number(/\[S(\d+)\]/.exec(text)?.[1] ?? 4);
const dims = (n: number) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n, weakness: `thin on ${n}` });

function brain(calls: { sys: string; user: string; model: string }[], scenarios: string[] = []) {
  let sc = 0;
  const open = (async (provider: string, model: string, messages: { content: string }[]) => {
    const sys = messages[0].content;
    const user = messages[1]?.content ?? "";
    calls.push({ sys, user, model });
    let reply = "{}";
    if (sys.includes("You are UltraPal, the lead")) {
      const who = /You are ([A-Za-z ]+?):/.exec(user)?.[1] ?? "Someone";
      const variation = /ROUND, "([^"]+)"/.exec(user)?.[1] ?? "";
      reply = JSON.stringify({ action: "answer", text: `[S${skillOf(who, variation)}] ${who}${variation ? ` / ${variation}` : ""} predicts fees near 12 percent, confidence 70 percent.` });
    } else if (sys.includes("Extract a structured outcome")) {
      const head = /REPORT:\n([^\n]+)/.exec(user)?.[1] ?? "report";
      reply = JSON.stringify({ headline: head.slice(0, 80), prediction: "fees near 12 percent", confidence: 70, recommendation: "go with option 2", evidence: [{ claim: "published fee page", source: "stripe.com" }], risks: ["fx"] });
    } else if (sys.includes("independent, blind judge")) {
      const parts = [...user.matchAll(/REPORT ([A-H])\n[^\n]*\nHeadline: ([^\n]*)/g)];
      reply = JSON.stringify({ scores: Object.fromEntries(parts.map((p) => [p[1], dims(skillIn(p[2]))])), best: parts[0]?.[1], why: "the better sourced report" });
    } else if (sys.includes("final combined outcome")) {
      reply = "BEST OUTCOME: go with option 2 at about 12 percent fees.\nWHY IT WON: best sourced.\nWHAT THE OTHERS GOT RIGHT:\n- (Skeptic) fx fees can double the cost\nWATCH OUT FOR: fx.";
    } else if (sys.includes("design the NEXT test scenario")) {
      const name = scenarios[sc++] ?? "Another one";
      reply = JSON.stringify({ name, change: `${name}: change one assumption here.` });
    } else if (sys.includes("Turn a person's scenario into ONE measurable question")) {
      reply = JSON.stringify({ question: "Will fees stay near 12 percent?", success: "under 15 percent", horizon: "1 year" });
    }
    return { ok: true as const, data: { provider, model, body: stream(sse(reply)) } };
  }) as unknown as typeof openChat;
  return open;
}
const MODELS = [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }, { provider: "nvidia" as const, model: "nvidia/nemotron-3.5-lightning-30b-a3b" }, { provider: "openrouter" as const, model: "google/gemma-4-31b-it:free" }, { provider: "bluesminds" as const, model: "meta/muse-glimmer-30b" }];
function setup(scenarios: string[] = []) {
  const calls: { sys: string; user: string; model: string }[] = [];
  const open = brain(calls, scenarios);
  const deps = mkDeps(open, { model: { open, now: () => 1000, models: MODELS } as never });
  const closed: string[] = [];
  let n = 0;
  const a: ArenaDeps = { open: () => mkSession({ id: `sub${++n}`, vm: null }), close: async (s) => { closed.push(s.id); }, now: Date.now };
  return { calls, deps, a, closed, session: mkSession({ id: "main-s", vm: null }) };
}
const kinds = (ev: CEvent[]) => ev.map((e) => e.kind);

describe("Battle: contenders run, then a judged knockout", () => {
  const plan = defaultPlan("battle", 4, { question: "Will fees stay near 12 percent?" });
  const run = async () => {
    const s = setup();
    const { ev } = await collect(runArena(s.session, { prompt: "Sell reports for 5 cents", plan, planMode: "auto", choice: { level: "standard" } }, s.deps, s.a));
    return { ...s, ev };
  };
  it("runs every contender on its own session and model family, and closes every session", async () => {
    const { ev, closed, calls } = await run();
    expect(closed).toHaveLength(4);
    const planners = calls.filter((c) => c.sys.includes("You are UltraPal, the lead"));
    expect(new Set(planners.map((c) => c.model.split("/")[0])).size).toBeGreaterThanOrEqual(3);
    expect(ev.filter((e) => e.kind === "contender_done")).toHaveLength(4);
  });
  it("the arena starts with the bracket, plays semi-finals, third place and the final, and the strongest report wins", async () => {
    const { ev } = await run();
    const start = ev.find((e) => e.kind === "arena");
    expect(start).toMatchObject({ mode: "battle", adaptive: false });
    expect(start && start.kind === "arena" && start.bracket?.rounds.length).toBe(2);
    const matches = ev.filter((e) => e.kind === "arena_match").map((e) => (e.kind === "arena_match" ? e.match : null)!);
    expect(matches.map((m) => m.label).sort()).toEqual(["Final", "Semi-final", "Semi-final", "Third place"]);
    const final = ev.find((e) => e.kind === "arena_final");
    expect(final && final.kind === "arena_final" && final.final.winner).toContain("pragmatist");
    for (const m of matches) {
      expect(m.judged).toBe(true);
      expect(m.duel!.hp.a).toBeGreaterThanOrEqual(0);
      expect(m.duel!.hp.b).toBeLessThanOrEqual(100);
      expect(m.why!.headline.length).toBeGreaterThan(10);
    }
  });
  it("the judge is blind: no persona names, and only two reports per match", async () => {
    const { calls } = await run();
    const judge = calls.filter((c) => c.sys.includes("independent, blind judge"));
    expect(judge).toHaveLength(4);
    for (const c of judge) {
      expect(c.user).not.toMatch(/Maximalist|Skeptic|Pragmatist|Risk officer|gpt-oss|nemotron|gemma/);
      expect([...c.user.matchAll(/REPORT [A-H]\n/g)]).toHaveLength(2);
    }
  });
  it("writes the combined outcome, the report and the scores, and finishes cleanly", async () => {
    const { ev, session } = await run();
    expect(Object.keys(session.files)).toEqual(expect.arrayContaining(["artifacts/battle-report.md", "artifacts/battle-scores.csv"]));
    const answer = ev.filter((e) => e.kind === "answer").map((e) => (e.kind === "answer" ? e.delta : "")).join("");
    expect(answer).toContain("BEST OUTCOME");
    const final = ev.find((e) => e.kind === "arena_final");
    expect(final && final.kind === "arena_final" && final.final.provenance.map((p) => p.point)).toContain("fx fees can double the cost");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
    expect(kinds(ev).indexOf("arena_scores")).toBeLessThan(kinds(ev).indexOf("arena_final"));
  });
  it("the reducer builds the whole picture: bracket, matches, health, scores and the final", async () => {
    const { ev } = await run();
    const state = ev.reduce(applyCEvent, newRun("r", "p")).arena!;
    expect(state.matches).toHaveLength(4);
    expect(state.phase).toBe("done");
    expect(state.contenders).toHaveLength(4);
    expect(state.contenders.every((c) => c.outcome && c.score)).toBe(true);
    expect(Object.values(state.hp).every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(state.final?.winner).toBe(state.winner);
    expect(state.contenders.find((c) => c.info.id === state.winner)!.run.answer).toContain("predicts fees");
  });
  it("two contenders: one match, the final", async () => {
    const s = setup();
    const { ev } = await collect(runArena(s.session, { prompt: "x scenario", plan: defaultPlan("battle", 2, { question: "Will fees stay near 12 percent?" }), planMode: "auto", choice: { level: "light" } }, s.deps, s.a));
    expect(ev.filter((e) => e.kind === "arena_match")).toHaveLength(1);
  });
  it("a team that never reports loses its match, and the match says there was nothing to judge (not that the judge failed)", async () => {
    const s = setup();
    const quiet = (async (provider: string, model: string, messages: { content: string }[]) => {
      const sys = messages[0].content;
      // the first contender's planner never gets an answer out: its stream is empty
      if (sys.includes("You are UltraPal, the lead") && /You are Maximalist:/.test(messages[1]?.content ?? "")) return { ok: false as const, error: "no answer" } as never;
      return (s.deps.model.open as unknown as (p: string, m: string, x: { content: string }[]) => Promise<unknown>)(provider, model, messages) as never;
    }) as never;
    const deps = { ...s.deps, model: { ...s.deps.model, open: quiet, hedge: 1 } };
    const { ev } = await collect(runArena(s.session, { prompt: "x scenario", plan: defaultPlan("battle", 2, { question: "Will fees stay near 12 percent?" }), planMode: "auto", choice: { level: "light" } }, deps, s.a));
    const match = ev.find((e) => e.kind === "arena_match");
    expect(match && match.kind === "arena_match" && match.match.judged).toBe(false);
    expect(match && match.kind === "arena_match" && match.match.unjudged).toBe("no_report");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("refuses a plan that is not a battle", async () => {
    const s = setup();
    const bad = { ...plan, slots: plan.slots.map((x) => ({ ...x, stance: { label: "same", text: "the same prediction" } })) };
    const { ev } = await collect(runArena(s.session, { prompt: "x", plan: bad, planMode: "manual", choice: { level: "standard" } }, s.deps, s.a));
    expect(ev.at(-1)).toMatchObject({ kind: "error" });
    expect(s.closed).toHaveLength(0);
  });
});

describe("Loop: one team per round, different scenarios, until it is good enough", () => {
  const plan = defaultPlan("loop", 6, { question: "Will fees stay near 12 percent?" });
  it("adapts the scenario each round, keeps the best, and stops once nothing beats it", async () => {
    const s = setup(["Worst realistic case", "Half the budget", "Hostile counterpart"]);
    const { ev } = await collect(runArena(s.session, { prompt: "Sell reports for 5 cents", plan, planMode: "auto", choice: { level: "standard" } }, s.deps, s.a));
    const state = ev.reduce(applyCEvent, newRun("r", "p")).arena!;
    expect(state.mode).toBe("loop");
    expect(state.adaptive).toBe(true);
    expect(state.contenders.map((c) => c.info.name)).toEqual(["Round 1: Base case", "Round 2: Worst realistic case", "Round 3: Half the budget", "Round 4: Hostile counterpart", "Round 5: Another one"]);
    // round 1 is one report on its own, so nothing judges it: its total is the counted score (3). From round 2 on, 40% counted + 60% judged.
    expect(state.history.map((h) => h.best)).toEqual([3, ...[7, 9, 9, 9].map((n) => 0.4 * 3 + 0.6 * n)].map((n) => expect.closeTo(n, 1)));
    expect(state.winner).toContain("r3");
    expect(ev.filter((e) => e.kind === "arena_scores").map((e) => (e.kind === "arena_scores" ? e.round : 0))).toEqual([1, 2, 3, 4, 5]);
    expect(s.closed).toHaveLength(5); // it planned six rounds and stopped after five
    const writing = ev.find((e) => e.kind === "arena_phase" && e.phase === "writing");
    expect(writing && writing.kind === "arena_phase" && writing.note).toContain("two rounds in a row brought no improvement");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("later rounds are told what to beat", async () => {
    const s = setup(["Worst realistic case", "Half the budget", "Hostile counterpart"]);
    await collect(runArena(s.session, { prompt: "x scenario", plan, planMode: "auto", choice: { level: "standard" } }, s.deps, s.a));
    const planners = s.calls.filter((c) => c.sys.includes("You are UltraPal, the lead"));
    expect(planners[0].user).not.toContain("THE BEST REPORT SO FAR");
    expect(planners[1].user).toContain("THE BEST REPORT SO FAR");
    expect(planners[1].user).not.toContain("A judge found this weak"); // one report cannot be compared with itself
    expect(planners[2].user).toContain("A judge found this weak");
  });
  it("a manual list runs the scenarios exactly as given, in order", async () => {
    const s = setup();
    const manual = { ...defaultPlan("loop", 2, { question: "Will fees stay near 12 percent?" }), slots: defaultPlan("loop", 2, { question: "Will fees stay near 12 percent?" }).slots.map((x, i) => ({ ...x, scenario: { name: ["Base case", "Half the budget"][i], change: "as written by the person" } })) };
    const { ev } = await collect(runArena(s.session, { prompt: "x scenario", plan: manual, planMode: "manual", choice: { level: "standard" } }, s.deps, s.a));
    const start = ev.find((e) => e.kind === "arena");
    expect(start && start.kind === "arena" && start.adaptive).toBe(false);
    expect(start && start.kind === "arena" && start.contenders.map((c) => c.scenario)).toEqual(["Base case: as written by the person", "Half the budget: as written by the person"]);
    expect(s.calls.some((c) => c.sys.includes("design the NEXT test scenario"))).toBe(false);
    expect(ev.filter((e) => e.kind === "contender_done")).toHaveLength(2);
  });
});
