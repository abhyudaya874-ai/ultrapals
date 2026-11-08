import { describe, expect, it } from "vitest";
import type { CEvent } from "./events";
import { applyCEvent, newRun, parseCStream, subagents } from "./run";

const fold = (evs: CEvent[]) => evs.reduce(applyCEvent, newRun("r1", "build a page"));

describe("applyCEvent", () => {
  it("folds a delegated run: agent rows, messages in order, steps, terminal, files, answer", () => {
    const r = fold([
      { kind: "agent", id: "main", role: "main", title: "Computer", state: "running" },
      { kind: "message", id: "m1", from: "main", to: "terminal-1", text: "Create a vite app" },
      { kind: "agent", id: "terminal-1", role: "terminal", title: "Terminal", state: "running" },
      { kind: "step", agent: "terminal-1", id: "s1", label: "Running npm init", state: "running" },
      { kind: "term", agent: "terminal-1", id: "t1", command: "npm init -y", state: "running", out: "Wrote " },
      { kind: "term", agent: "terminal-1", id: "t1", command: "npm init -y", state: "ok", out: "to package.json", exit: 0, ms: 900 },
      { kind: "file", agent: "terminal-1", id: "f1", path: "/workspace/index.html", created: true, adds: 12, removes: 0, preview: "<h1>hi</h1>" },
      { kind: "step", agent: "terminal-1", id: "s1", label: "Ran npm init", state: "ok", ms: 900 },
      { kind: "agent", id: "terminal-1", role: "terminal", title: "Terminal", state: "ok", ms: 4000 },
      { kind: "message", id: "m2", from: "terminal-1", to: "main", text: "Done." },
      { kind: "answer", delta: "It is " }, { kind: "answer", delta: "ready." },
      { kind: "done", used: [], model: "gpt-oss-120b · groq", ms: 8000 },
    ]);
    expect(r.timeline).toEqual([{ t: "agent", id: "main" }, { t: "message", id: "m1" }, { t: "agent", id: "terminal-1" }, { t: "message", id: "m2" }]);
    const t = r.agents.find((a) => a.id === "terminal-1")!;
    expect(t).toMatchObject({ state: "ok", ms: 4000, steps: [{ id: "s1", label: "Ran npm init", state: "ok" }] });
    expect(t.terms).toEqual([{ id: "t1", command: "npm init -y", state: "ok", out: "Wrote to package.json", exit: 0, ms: 900 }]);
    expect(t.files).toHaveLength(1);
    expect(r).toMatchObject({ answer: "It is ready.", status: "done", model: "gpt-oss-120b · groq" });
    expect(subagents(r).map((a) => a.id)).toEqual(["terminal-1"]);
  });
  it("creates a blank row when an event arrives before its agent announces itself", () => {
    const r = fold([{ kind: "step", agent: "browser-1", id: "s", label: "x", state: "running" }]);
    expect(r.agents[0]).toMatchObject({ id: "browser-1", role: "browser", steps: [{ id: "s" }] });
    expect(r.timeline).toEqual([{ t: "agent", id: "browser-1" }]);
  });
  it("keeps only the tail of a huge terminal output", () => {
    const r = fold([{ kind: "term", agent: "terminal-1", id: "t", command: "yes", state: "running", out: "x".repeat(30_000) }]);
    expect(r.agents[0].terms[0].out).toHaveLength(20_000);
  });
  it("tracks workspace, page, sources and errors without touching the answer", () => {
    const r = fold([{ kind: "workspace", liveViewUrl: "https://a.kernel.sh/x" }, { kind: "page", url: "https://a.example", title: "A" }, { kind: "answer", delta: "part" }, { kind: "error", message: "busy" }]);
    expect(r).toMatchObject({ liveViewUrl: "https://a.kernel.sh/x", page: { url: "https://a.example", title: "A" }, answer: "part", status: "error", error: "busy" });
  });
  it("does not mutate the previous run", () => {
    const a = newRun("r", "p");
    applyCEvent(a, { kind: "answer", delta: "x" });
    expect(a.answer).toBe("");
  });
});

describe("parseCStream", () => {
  const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
  it("parses complete events, keeps the tail and skips junk", () => {
    const r = parseCStream("data: nope\n\n" + ev({ x: 1 }) + ev({ kind: "answer", delta: "a" }) + 'data: {"kind":"ans');
    expect(r.events).toEqual([{ kind: "answer", delta: "a" }]);
    expect(r.rest).toBe('data: {"kind":"ans');
  });
});
