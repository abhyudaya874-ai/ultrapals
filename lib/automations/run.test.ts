import { describe, expect, it } from "vitest";
import { applyCEvent, newRun } from "@/lib/computer/run";
import type { CEvent } from "@/lib/computer/events";
import { mkDeps, mkSession, scripted } from "@/lib/computer/fakes";
import { newAutomation, Spec } from "./core";
import { framePrompt, runAutomation, summarizeRun, type RunDeps } from "./run";

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
