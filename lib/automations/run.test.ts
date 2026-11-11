import { describe, expect, it } from "vitest";
import { defaultPlan } from "@/lib/arena/plan";
import { applyCEvent, newRun } from "@/lib/computer/run";
import type { CEvent } from "@/lib/computer/events";
import { mkDeps, mkSession, scripted, stream } from "@/lib/computer/fakes";
import { newAutomation, Spec, type Automation, type RunSummary } from "./core";
import { framePrompt, parseWatch, previousReport, runAutomation, summarizeRun, watchTask, type RunDeps } from "./run";

const auto = () => newAutomation(Spec.parse({ name: "Rails watch", prompt: "Compare the payment rails and save a CSV", schedule: { kind: "every", minutes: 60 }, level: "high" }), "a1", 0);
const fold = (...e: CEvent[]) => e.reduce(applyCEvent, newRun("r1", "p"));
const file = (path: string, extra: Partial<Extract<CEvent, { kind: "file" }>> = {}): CEvent => ({ kind: "file", agent: "terminal-1", id: path, path, created: true, adds: 1, removes: 0, preview: "preview", mode: "write", ...extra });

describe("framePrompt", () => {
  it("tells the agent nobody is watching and keeps the user's task intact", () => {
    const p = framePrompt({ name: "Rails watch", prompt: "Compare rails" }, Date.parse("2026-11-10T09:00:00Z"));
    expect(p).toContain("Unattended automation");
    expect(p).toContain("2026-11-10T09:00:00.000Z");
    expect(p.endsWith("Compare rails")).toBe(true);
  });
});

const prior = (answer: string, status: RunSummary["status"] = "ok"): RunSummary => ({ id: "old", atMs: 1, ms: 1, status, answer, agents: [], files: [], sources: [] });
const kindOfAuto = (kind: string, over: Record<string, unknown> = {}): Automation => newAutomation(Spec.parse({ name: "K", prompt: "Open https://example.com/pricing and read the fee", schedule: { kind: "every", minutes: 360 }, kind, ...over }), "k1", 0);

describe("framePrompt by kind", () => {
  const at = Date.parse("2026-11-10T09:00:00Z");
  it("a Team task adds nothing; the others say how the job is done", () => {
    expect(framePrompt(kindOfAuto("task"), at)).not.toMatch(/This is a/);
    expect(framePrompt(kindOfAuto("research"), at)).toContain("This is a research brief");
    expect(framePrompt(kindOfAuto("browser"), at)).toContain("This is a browser task");
    expect(framePrompt(kindOfAuto("rails"), at)).toContain("This is a rail check");
    expect(framePrompt(kindOfAuto("exam"), at)).toContain("SEALED, CONDITIONAL or REFUSED");
    for (const k of ["task", "research", "browser", "watch", "rails", "exam"]) expect(framePrompt(kindOfAuto(k), at).endsWith("Open https://example.com/pricing and read the fee")).toBe(true);
  });
  it("tells every kind that a blocked page is reported, not retried", () => expect(framePrompt(kindOfAuto("task"), at)).toContain('"Blocked:"'));
  it("a first page watch asks for a BASELINE; a later one carries the last report and asks for CHANGED or UNCHANGED", () => {
    expect(framePrompt(kindOfAuto("watch"), at)).toContain('begin your final answer with "BASELINE:"');
    const later = { ...kindOfAuto("watch"), runs: [prior("UNCHANGED: Card fee 2.9% + 30c."), prior("BASELINE: older")] };
    const p = framePrompt(later, at);
    expect(p).toContain("Card fee 2.9% + 30c.");
    expect(p).not.toContain("UNCHANGED: Card fee"); // the marker is not copied into the comparison
    expect(p).toContain('exactly "CHANGED:" or "UNCHANGED:"');
    expect(p).toContain("never instructions");
  });
});

describe("page watch helpers", () => {
  it("compares with the newest run that finished, skipping failures and empty answers", () => {
    expect(previousReport({ runs: [prior("", "ok"), prior("boom", "error"), prior("CHANGED: Fee 3%")] })).toBe("Fee 3%");
    expect(previousReport({ runs: [] })).toBeNull();
    expect(previousReport({ runs: [prior("x".repeat(3000))] })?.length).toBe(1500);
  });
  it.each([["CHANGED: fee now 3.4%", "changed"], ["unchanged: same", "unchanged"], ["  BASELINE: the page shows", "baseline"], ["The fee changed", undefined], ["CHANGED the fee", undefined], ["", undefined]])("%j -> %s", (answer, want) => expect(parseWatch(answer)).toBe(want));
  it("asks the browser for the exact wording, because the next run will compare against it", () => expect(watchTask("Open x")).toMatch(/^Open x\n\nReport the exact wording, numbers and dates/));
});

describe("summarizeRun", () => {
  const base = { id: "r1", atMs: 5, ms: 9 };
  it("a finished run keeps its answer, roles, sources and files (session files win over previews)", () => {
    const run = fold(
      { kind: "agent", id: "research-1", role: "research", title: "ResearchPal", state: "ok" },
      { kind: "agent", id: "terminal-1", role: "terminal", title: "TerminalPal", state: "ok" },
      { kind: "agent", id: "research-1", role: "research", title: "ResearchPal", state: "ok" },
      file("/workspace/artifacts/a.csv", { preview: "cut preview" }),
      file("/workspace/out.txt", { preview: "terminal text" }),
      file("/workspace/skipped.txt", { mode: "read" }),
      { kind: "sources", sources: [{ n: 1, host: "x.test", url: "https://x.test/a", title: "A", snippet: "s", publishedDate: null, provider: "tavily", score: null }] },
      { kind: "answer", delta: "Stripe leads." },
      { kind: "done", used: [1], model: "gpt-oss-120b · groq", ms: 5 },
    );
    const s = summarizeRun({ ...base, run, files: { "artifacts/a.csv": "full,csv\n1,2\n" } });
    expect(s).toMatchObject({ status: "ok", answer: "Stripe leads.", agents: ["research", "terminal"], model: "gpt-oss-120b · groq", sources: [{ title: "A", url: "https://x.test/a" }] });
    expect(s.files).toEqual([{ path: "/workspace/artifacts/a.csv", content: "full,csv\n1,2\n" }, { path: "/workspace/out.txt", content: "terminal text" }]);
    expect(s).not.toHaveProperty("error");
  });
  it("a failed run says why", () => {
    const s = summarizeRun({ ...base, run: fold({ kind: "error", message: "every allowlisted model failed" }), files: {} });
    expect(s).toMatchObject({ status: "error", error: "every allowlisted model failed", answer: "" });
  });
  it.each([[""], ["{}"], ["  [] "]])("a run whose whole report is %j counts as failed, not ok", (answer) => {
    const run = fold({ kind: "answer", delta: answer }, { kind: "done", used: [], model: "m", ms: 1 });
    expect(summarizeRun({ ...base, run, files: {} })).toMatchObject({ status: "error", error: "the agent finished without writing a report" });
  });
  it("a wall the browser met with nobody to help is kept as a fact of the run, and the run still counts as finished", () => {
    const run = fold(
      { kind: "message", id: "from-browser-1", from: "browser-1", to: "main", text: "Blocked: google.com is showing a security check (a CAPTCHA). Solve it in the browser. Nobody is available to help in this run." },
      { kind: "answer", delta: "Google blocked the browser with a CAPTCHA, so I used other sources." },
      { kind: "done", used: [], model: "m", ms: 1 },
    );
    const s = summarizeRun({ ...base, run, files: {}, kind: "browser" });
    expect(s).toMatchObject({ status: "ok", blocked: expect.stringMatching(/^Blocked: google\.com is showing a security check/) });
  });
  it("a message that merely mentions Blocked: is not a wall", () => {
    const run = fold({ kind: "message", id: "m1", from: "research-1", to: "main", text: "Blocked: nothing" }, { kind: "answer", delta: "ok" }, { kind: "done", used: [], model: "m", ms: 1 });
    expect(summarizeRun({ ...base, run, files: {} })).not.toHaveProperty("blocked");
  });
  it("only a page watch gets a verdict, and only from a finished run", () => {
    const done = (a: string) => fold({ kind: "answer", delta: a }, { kind: "done", used: [], model: "m", ms: 1 });
    expect(summarizeRun({ ...base, run: done("CHANGED: fee 3%"), files: {}, kind: "watch" }).watch).toBe("changed");
    expect(summarizeRun({ ...base, run: done("CHANGED: fee 3%"), files: {}, kind: "task" })).not.toHaveProperty("watch");
    expect(summarizeRun({ ...base, run: fold({ kind: "answer", delta: "CHANGED: x" }, { kind: "error", message: "boom" }), files: {}, kind: "watch" })).not.toHaveProperty("watch");
  });
  it("caps the number of files and the total size", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`artifacts/f${i}.md`, "x".repeat(25_000)]));
    const s = summarizeRun({ ...base, run: fold({ kind: "done", used: [], model: "m", ms: 1 }), files: many });
    expect(s.files.length).toBeLessThanOrEqual(8);
    expect(s.files.every((f) => f.content.length <= 20_000)).toBe(true);
    expect(s.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(60_000);
  });
});

describe("runAutomation", () => {
  const rd = (model: ReturnType<typeof scripted>, over: Parameters<typeof mkDeps>[1] = {}, closed: string[] = []): RunDeps => ({
    deps: mkDeps(model.open, over),
    now: (() => { let t = 1000; return () => (t += 50); })(),
    id: () => "run-1",
    open: () => mkSession({ id: "auto-session", vm: null }),
    close: async (s) => { closed.push(s.id); },
  });
  const research = { research: async function* () {
    yield { kind: "sources" as const, sources: [{ n: 1, host: "x.test", url: "https://x.test/a", title: "A", snippet: "s", publishedDate: null, provider: "tavily" as const, score: null }] };
    yield { kind: "answer" as const, delta: "Stripe has the lowest fee [1]." };
    yield { kind: "done" as const, used: [1], provider: "groq" as const, model: "m", ms: 5 };
  } };

  it("runs the whole team headless and ends the conversation", async () => {
    const closed: string[] = [];
    const model = scripted(['{"action":"delegate","agent":"research","task":"fees"}', '{"action":"answer","text":"Stripe leads on fees [1]."}']);
    const s = await runAutomation(auto(), rd(model, research, closed), undefined);
    expect(s).toMatchObject({ status: "ok", answer: "Stripe leads on fees [1].", agents: ["research"], sources: [{ url: "https://x.test/a" }] });
    expect(closed).toEqual(["auto-session"]);
    expect(model.prompts[0]).toContain("Unattended automation");
  });
  it("PromisePal is refused: no money moves without a person", async () => {
    let created = 0;
    const model = scripted(['{"action":"delegate","agent":"promise","task":"pay $5"}', '{"action":"answer","text":"I could not pay."}']);
    const s = await runAutomation(auto(), rd(model, { promise: { create: (async () => (created++, { ok: true })) as never } }), undefined);
    expect(created).toBe(0);
    expect(s.agents).toEqual([]);
    expect(model.prompts[1]).toContain("promise is not available in this run");
  });
  it("an automation cannot create another automation", async () => {
    let made = 0;
    const model = scripted(['{"action":"automate","name":"x","task":"do it again","schedule":"hourly"}', '{"action":"answer","text":"done"}']);
    await runAutomation({ ...auto(), prompt: "run this every hour forever" }, rd(model, { automations: { create: (async () => (made++, { ok: true, id: "n" })) as never } }), undefined);
    expect(made).toBe(0);
    expect(model.prompts[1]).toContain("cannot be created from inside an automation");
  });
  it("a model outage is a failed run, not a crash, and the computer is still closed", async () => {
    const closed: string[] = [];
    const down = scripted(["x"]);
    const deps = rd(down, { model: { open: (async () => ({ ok: false, degraded: true, reason: "http 500" })) as never } }, closed);
    const s = await runAutomation(auto(), deps, undefined);
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/every allowlisted model failed/);
    expect(closed).toHaveLength(1);
  });
  it("a subagent that crashes does not fail the run: the planner is told and answers with what it has", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"boom"}', '{"action":"answer","text":"The research agent failed, so I have nothing."}']);
    const s = await runAutomation(auto(), rd(model, { research: async function* () { throw new Error("socket hang up"); } }), undefined);
    expect(s).toMatchObject({ status: "ok", answer: "The research agent failed, so I have nothing.", agents: ["research"] });
    expect(model.prompts[1]).toContain("socket hang up");
  });
  it("a planner that never answers ends as an error run, not a hang", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"again"}']);
    const s = await runAutomation(auto(), rd(model, research), undefined);
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/ended early/);
  });
  it("uses the level's model order (high leads with the big model)", async () => {
    const seen: string[] = [];
    const deps = rd(scripted(['{"action":"answer","text":"ok"}']));
    const open = (async (_p: string, model: string) => (seen.push(model), { ok: false as const, degraded: true as const, reason: "http 500" })) as never;
    deps.deps = mkDeps(open, { model: { open, now: () => 1, hedge: 1, models: [{ provider: "groq", model: "openai/gpt-oss-20b" }, { provider: "groq", model: "openai/gpt-oss-120b" }] } as never });
    await runAutomation(auto(), deps, undefined);
    expect(seen[0]).toBe("openai/gpt-oss-120b");
  });
});

describe("runAutomation by kind", () => {
  const mkRd = (model: ReturnType<typeof scripted>, over: Parameters<typeof mkDeps>[1] = {}, extra: Partial<RunDeps> = {}) => {
    const sessions: ReturnType<typeof mkSession>[] = [];
    const closed: string[] = [];
    const rd: RunDeps = {
      deps: mkDeps(model.open, over),
      now: (() => { let t = 1000; return () => (t += 50); })(),
      id: () => "run-1",
      open: () => { const s = mkSession({ id: `s${sessions.length + 1}`, vm: null }); sessions.push(s); return s; },
      close: async (s) => { closed.push(s.id); },
      ...extra,
    };
    return { rd, sessions, closed };
  };
  const research = { research: async function* () {
    yield { kind: "answer" as const, delta: "ResearchPal found three sources [1]." };
    yield { kind: "done" as const, used: [1], provider: "groq" as const, model: "m", ms: 5 };
  } };
  const SORRY = { url: "https://www.google.com/sorry/index?continue=x", title: "https://www.google.com/search?q=x", text: "Our systems have detected unusual traffic from your computer network. This page checks to see if it's really you sending the requests, and not a robot.", elements: [] };
  const FEE = (text: string) => ({ url: "https://example.com/pricing", title: "Pricing", text: `${text} `.repeat(6), elements: [] });
  // The level races two models on every browsing step, so replies are chosen by who is asking, not by the order of the calls.
  const byAsker = (browser: () => string, planner: string) => {
    const prompts: { sys: string; user: string }[] = [];
    const open = (async (provider: string, model: string, messages: { content: string }[]) => {
      const sys = messages[0].content;
      const user = messages[1]?.content ?? "";
      prompts.push({ sys, user });
      const reply = sys.startsWith("You drive a real web browser") ? browser() : planner;
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`;
      return { ok: true as const, data: { provider, model, body: stream(body) } };
    }) as never;
    return { open, prompts, planner: () => prompts.filter((p) => p.sys.startsWith("You are UltraPal")), browser: () => prompts.filter((p) => p.sys.startsWith("You drive a real web browser")) };
  };

  it("a research brief starts with the research agent, never plans a browser or terminal, and says how to do the job", async () => {
    const model = scripted(['{"action":"answer","text":"Three vendors changed fees [1]."}']);
    const { rd } = mkRd(model, research);
    const s = await runAutomation(kindOfAuto("research"), rd, undefined);
    expect(s).toMatchObject({ status: "ok", answer: "Three vendors changed fees [1].", agents: ["research"] });
    expect(model.calls()).toBe(1); // the research agent went first; the planner only wrote the report
    expect(model.prompts[0]).toContain("This is a research brief");
    expect(model.prompts[0]).toContain("ResearchPal found three sources");
  });
  it("a research brief cannot use the browser even if the planner asks", async () => {
    const model = scripted(['{"action":"delegate","agent":"browser","task":"open a page"}', '{"action":"answer","text":"no browser"}']);
    const { rd } = mkRd(model, research);
    await runAutomation(kindOfAuto("research"), rd, undefined);
    expect(model.prompts[1]).toContain("browser is not available in this run");
  });
  it("a browser task starts with the browser agent on the person's words, and may take as many steps as one typed in the browser box", async () => {
    let n = 0;
    const m = byAsker(() => `{"action":"goto","url":"https://example.com/p${n++}"}`, '{"action":"answer","text":"Could not finish in the steps allowed."}');
    const { rd } = mkRd(scripted(["unused"]), { model: { open: m.open, now: () => 1, models: [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }] }, vm: { snapshot: async () => ({ ok: true as const, data: FEE("Fee page") }), goto: async () => ({ ok: true as const, data: null }) } });
    const s = await runAutomation(kindOfAuto("browser"), rd, undefined);
    expect(s).toMatchObject({ status: "ok", agents: ["browser"], answer: "Could not finish in the steps allowed." });
    expect(m.browser()[0].user).toContain("TASK: Open https://example.com/pricing and read the fee");
    expect(m.planner()).toHaveLength(1); // the browser went first; the planner only wrote the report
    expect(m.planner()[0].user).toContain("used all 20 steps"); // the limit of a person's own task, not the planner's 12
  });
  it("a browser task that meets a CAPTCHA with nobody to help records the wall and carries on without waiting", async () => {
    const model = scripted(['{"action":"answer","text":"Google showed a CAPTCHA, so I could not read the page."}']);
    const { rd, sessions } = mkRd(model, { vm: { snapshot: async () => ({ ok: true as const, data: SORRY }) } });
    const s = await runAutomation(kindOfAuto("browser"), rd, undefined);
    expect(s.status).toBe("ok");
    expect(s.blocked).toMatch(/^Blocked: google\.com is showing a security check/);
    expect(sessions[0].handoff).toBeUndefined(); // nothing waits for a person that is not there
    expect(model.calls()).toBe(1);
  });
  it("a page watch compares with the last report and records whether it changed", async () => {
    const m = byAsker(() => '{"action":"finish","answer":"Card fee 3.4% + 30c."}', '{"action":"answer","text":"CHANGED: the fee is now 3.4% (it was 2.9%)."}');
    const { rd } = mkRd(scripted(["unused"]), { model: { open: m.open, now: () => 1, models: [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }] }, vm: { snapshot: async () => ({ ok: true as const, data: FEE("Card fee") }) } });
    const a = { ...kindOfAuto("watch"), runs: [prior("UNCHANGED: Card fee 2.9% + 30c.")] };
    const s = await runAutomation(a, rd, undefined);
    expect(s).toMatchObject({ status: "ok", watch: "changed", answer: "CHANGED: the fee is now 3.4% (it was 2.9%)." });
    expect(m.browser()[0].user).toContain("Report the exact wording, numbers and dates"); // the browser is asked to quote what it sees
    expect(m.planner()[0].user).toContain("Card fee 2.9% + 30c."); // the planner holds the old report
    expect(m.planner()[0].user).toContain("Card fee 3.4% + 30c."); // and what the browser just saw
  });
  it("the first page watch is a baseline", async () => {
    const m = byAsker(() => '{"action":"finish","answer":"Card fee 2.9% + 30c."}', '{"action":"answer","text":"BASELINE: the page shows a card fee of 2.9% + 30c."}');
    const { rd } = mkRd(scripted(["unused"]), { model: { open: m.open, now: () => 1, models: [{ provider: "groq" as const, model: "openai/gpt-oss-120b" }] }, vm: { snapshot: async () => ({ ok: true as const, data: FEE("Card fee") }) } });
    expect((await runAutomation(kindOfAuto("watch"), rd, undefined)).watch).toBe("baseline");
  });
  it("a rail check and a deal exam start with their own agents", async () => {
    for (const [kind, agent, role] of [["rails", "situation", "situation"], ["exam", "rival", "rival"]] as const) {
      const model = scripted(['{"action":"answer","text":"done"}']);
      const { rd } = mkRd(model, { [agent === "situation" ? "situation" : "rival"]: undefined } as never);
      const s = await runAutomation(kindOfAuto(kind), rd, undefined);
      // the agent runs against fakes that return nothing; what matters is that it was the one chosen and that the planner then wrote the report
      expect(s.agents, kind).toContain(role);
      expect(model.prompts.at(-1), kind).toContain(`${agent === "situation" ? "rail check" : "deal exam"}`);
    }
  });
  it("a Battle drafts a plan for the question, runs the contest headless with the kind's team count, and keeps the winner's write-up", async () => {
    const model = scripted(["unused"]);
    const seen: { planArgs?: unknown[]; input?: { planMode: string; prompt: string; plan: { kind: string; slots: unknown[] } }; opened?: boolean } = {};
    const arena: NonNullable<RunDeps["arena"]> = {
      plan: (async (...args: unknown[]) => { seen.planArgs = args.slice(0, 3); return { plan: defaultPlan("battle", 3, { question: "Which is cheapest?" }), drafted: true }; }) as never,
      run: (async function* (_s: unknown, input: never, _d: unknown, a: { open: () => unknown }) {
        seen.input = input; seen.opened = typeof a.open === "function";
        yield { kind: "answer", delta: "Option B wins on cost." } as CEvent;
        yield { kind: "arena_final", final: { winner: "c2", text: "Option B wins on cost.", provenance: [], why: "best sourced", judge: null } } as CEvent;
        yield { kind: "done", used: [], model: "Battle · Autopilot", ms: 5 } as CEvent;
      }) as never,
    };
    const { rd, closed } = mkRd(model, {}, { arena });
    const a = kindOfAuto("battle", { prompt: "Which payment rail is cheapest for $0.25?", count: 4 });
    const s = await runAutomation(a, rd, undefined);
    expect(s).toMatchObject({ status: "ok", answer: "Option B wins on cost.", model: "Battle · Autopilot" });
    expect(seen.planArgs).toEqual(["battle", 4, "Which payment rail is cheapest for $0.25?"]);
    expect(seen.input).toMatchObject({ planMode: "auto", prompt: "Which payment rail is cheapest for $0.25?" });
    expect(seen.opened).toBe(true);
    expect(model.calls()).toBe(0); // the planner (runMain) is not involved
    expect(closed).toHaveLength(1);
  });
  it("a Loop is planned as a loop, with three rounds when the automation does not say", async () => {
    const seen: unknown[][] = [];
    const arena: NonNullable<RunDeps["arena"]> = {
      plan: (async (...args: unknown[]) => { seen.push(args.slice(0, 2)); return { plan: defaultPlan("loop", 3, { question: "q?" }), drafted: false }; }) as never,
      run: (async function* () { yield { kind: "answer", delta: "Sharper." } as CEvent; yield { kind: "done", used: [], model: "Loop · Autopilot", ms: 1 } as CEvent; }) as never,
    };
    const { rd } = mkRd(scripted(["unused"]), {}, { arena });
    expect((await runAutomation(kindOfAuto("loop"), rd, undefined)).answer).toBe("Sharper.");
    expect(seen).toEqual([["loop", 3]]);
  });
  it("a contest that crashes is a failed run, and every computer is still closed", async () => {
    const arena: NonNullable<RunDeps["arena"]> = {
      plan: (async () => ({ plan: defaultPlan("battle", 3, { question: "q?" }), drafted: false })) as never,
      run: (async function* () { throw new Error("kernel went away"); }) as never,
    };
    const { rd, closed } = mkRd(scripted(["unused"]), {}, { arena });
    const s = await runAutomation(kindOfAuto("battle"), rd, undefined);
    expect(s).toMatchObject({ status: "error", error: "kernel went away" });
    expect(closed).toHaveLength(1);
  });
});
