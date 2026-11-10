import { describe, expect, it } from "vitest";
import { runBrowserAgent } from "./browser-agent";
import { collect, mkDeps, mkSession, ok, page, scripted } from "./fakes";
import { runResearchAgent } from "./research-agent";
import { runTerminalAgent } from "./terminal-agent";
import { parseTermAction } from "./term-actions";

const ctx = (agent: string, deps: ReturnType<typeof mkDeps>, session = mkSession()) => ({ agent, session, deps });
const stepsOf = (ev: { kind: string }[]) => ev.filter((e) => e.kind === "step") as unknown as { id: string; label: string; state: string; detail?: string }[];

describe("browser agent", () => {
  it("searches, opens a page, clicks, and finishes with a cited answer; the page becomes a source", async () => {
    const model = scripted([
      '{"thought":"find","action":"search","query":"paypal l402"}',
      '{"thought":"open","action":"goto","url":"https://docs.example/l402"}',
      '{"thought":"click","action":"click","index":0}',
      '{"action":"finish","answer":"L402 combines HTTP 402 with payments [1]."}',
    ]);
    const urls = ["https://start.example/", "https://docs.example/l402", "https://docs.example/l402/more", "https://docs.example/l402/more"];
    let snaps = 0;
    const clicked: number[] = [];
    const deps = mkDeps(model.open, {
      search: [{ id: "t", label: "T", run: async () => ok([{ url: "https://docs.example/l402", title: "L402 docs", snippet: "s", publishedDate: null, provider: "tavily" as const, score: null }]) }],
      vm: {
        snapshot: async () => ok(page(urls[Math.min(snaps++, 3)], "Page", "body", [{ i: 0, tag: "a", label: "More", x: 1, y: 1 }])),
        goto: async () => ok(null),
        click: async (_b: unknown, el: { i: number }) => (clicked.push(el.i), ok(null)),
      },
    });
    const session = mkSession();
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps, session), "what is L402"));
    expect(ret).toBe("L402 combines HTTP 402 with payments [1].");
    expect(clicked).toEqual([0]);
    expect(stepsOf(ev).filter((s) => s.state === "ok").map((s) => s.label)).toEqual(['Searching the web for "paypal l402"', "Opening https://docs.example/l402", "Clicking [0] More", "Writing the answer"]);
    expect(ev.filter((e) => e.kind === "page")).toHaveLength(3);
    expect(session.sources.map((s) => s.url)).toEqual(["https://start.example/", "https://docs.example/l402", "https://docs.example/l402/more"]); // first page seen takes [1]; the visited search hit keeps its number
    expect(session.sources.find((s) => s.url.endsWith("/more"))?.provider).toBe("browser");
  });
  it("recovers from an unusable reply, then gives up after three in a row", async () => {
    const deps = mkDeps(scripted(["I'll just click it", "{ nope", '{"action":"finish","answer":"ok"}']).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", deps), "t"))).ret).toBe("ok");
    const bad = mkDeps(scripted(["x"]).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", bad), "t"))).ret).toContain("unusable replies");
  });
  it("reports a failed action as an error step and tells the model", async () => {
    const model = scripted(['{"action":"click","index":9}', '{"action":"finish","answer":"gave up"}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://a.example", "A")) } });
    const { ev } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(stepsOf(ev).find((s) => s.state === "error")?.detail).toContain("no element [9]");
    expect(model.prompts[1]).toContain("ERROR: no element [9]");
  });
  it("refuses pay (money goes through the promise agent), warns on the first repeat and stops on the second", async () => {
    const model = scripted(['{"action":"pay"}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://a.example", "A", "the page says hello")) } });
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(stepsOf(ev).map((s) => s.detail ?? s.state).filter((d) => d !== "running")).toEqual([expect.stringContaining("payments are not available"), "repeated"]);
    expect(model.prompts[2]).toContain("REPEAT:");
    expect(ret).toContain("kept repeating");
    expect(ret).toContain("the page says hello");
  });
  it("stops at the step budget when every step differs", async () => {
    const replies = Array.from({ length: 12 }, (_, i) => `{"action":"goto","url":"https://a.example/${i}"}`);
    const deps = mkDeps(scripted(replies).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")), goto: async () => ok(null) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", deps), "t"))).ret).toContain("used all 10 steps");
  });
  it("starts the VM once and announces the live view; a missing VM is a clean failure", async () => {
    const deps = mkDeps(scripted(['{"action":"finish","answer":"x"}']).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")) } });
    const { ev } = await collect(runBrowserAgent(ctx("browser-1", deps, mkSession({ vm: null })), "t"));
    expect(ev.find((e) => e.kind === "workspace")).toMatchObject({ liveViewUrl: expect.stringContaining("kernel.sh") });
    const none = mkDeps(scripted(["x"]).open, { vm: { open: async () => ({ ok: false as const, degraded: true as const, reason: "kernel off" }) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", none, mkSession({ vm: null })), "t"))).ret).toBe("I could not start the browser.");
  });
});

describe("terminal agent", () => {
  it("writes a file, runs a command, serves it, and finishes; events carry term output and file stats", async () => {
    const model = scripted([
      '{"action":"write","path":"site/index.html","content":"<h1>hi</h1>\\n"}',
      '{"action":"run","command":"ls site"}',
      '{"action":"serve","command":"cd site && python3 -m http.server 4321","port":4321}',
      '{"action":"finish","summary":"Site at http://localhost:4321"}',
    ]);
    const deps = mkDeps(model.open, {
      term: {
        write: async (_v: string, p: string) => ok({ path: `/workspace/${p}`, created: true, adds: 1, removes: 0, before: "" }),
        exec: async () => ok({ exit: 0, out: "index.html\n", ms: 12 }),
        serve: async () => ok({ exit: 0, out: "listening on :4321", ms: 800 }),
      },
    });
    const { ev, ret } = await collect(runTerminalAgent(ctx("terminal-1", deps), "make a page"));
    expect(ret).toBe("Site at http://localhost:4321");
    expect(ev.find((e) => e.kind === "file")).toMatchObject({ path: "/workspace/site/index.html", created: true, adds: 1, removes: 0 });
    expect(ev.filter((e) => e.kind === "term" && e.state === "ok")).toHaveLength(2);
    expect(model.prompts[1]).toContain("created /workspace/site/index.html (+1 -0)");
  });
  it("treats a non-zero exit as a normal, visible result the model must handle", async () => {
    const model = scripted(['{"action":"run","command":"npm test"}', '{"action":"finish","summary":"tests fail: see output"}']);
    const deps = mkDeps(model.open, { term: { exec: async () => ok({ exit: 1, out: "1 failing", ms: 5 }) } });
    const { ev } = await collect(runTerminalAgent(ctx("terminal-1", deps), "t"));
    expect(ev.find((e) => e.kind === "term" && e.state === "error")).toMatchObject({ exit: 1, out: "1 failing" });
    expect(model.prompts[1]).toContain("exit 1\n1 failing");
  });
  it("surfaces refused paths and read errors without crashing", async () => {
    const model = scripted(['{"action":"write","path":"../etc/x","content":"no"}', '{"action":"finish","summary":"refused"}']);
    const deps = mkDeps(model.open, { term: { write: async () => ({ ok: false as const, degraded: true as const, reason: "path outside /workspace: ../etc/x" }) } });
    const { ev } = await collect(runTerminalAgent(ctx("terminal-1", deps), "t"));
    expect(stepsOf(ev).find((s) => s.state === "error")?.detail).toContain("outside /workspace");
  });
  it("stops at the step budget when every step differs", async () => {
    const replies = Array.from({ length: 16 }, (_, i) => `{"action":"run","command":"echo ${i}"}`);
    const deps = mkDeps(scripted(replies).open, { term: { exec: async () => ok({ exit: 0, out: "", ms: 1 }) } });
    expect((await collect(runTerminalAgent(ctx("terminal-1", deps), "t"))).ret).toContain("used all 14 steps");
  });
  it("catches the 13x re-serve loop seen live: warns once, then stops with an honest partial result", async () => {
    const model = scripted(['{"action":"serve","command":"python3 -m http.server 4173","port":4173}']);
    let served = 0;
    const deps = mkDeps(model.open, { term: { serve: async () => (served++, ok({ exit: 0, out: "listening on :4173\nGET / -> Directory listing for /", ms: 5 })) } });
    const { ev, ret } = await collect(runTerminalAgent(ctx("terminal-1", deps), "t"));
    expect(served).toBe(1);
    expect(model.prompts[1]).toContain("Directory listing for /");
    expect(model.prompts[2]).toContain("REPEAT:");
    expect(ret).toContain("kept repeating");
    expect(ev.filter((e) => e.kind === "term")).toHaveLength(2);
  });
});

describe("parseTermAction", () => {
  it("accepts every action and explains bad ones", () => {
    for (const j of ['{"action":"run","command":"ls"}', '{"action":"write","path":"a","content":"x"}', '{"action":"read","path":"a"}', '{"action":"serve","command":"x","port":3000}', '{"action":"finish","summary":"s"}']) expect(parseTermAction(j).ok).toBe(true);
    expect(parseTermAction('{"action":"serve","command":"x","port":80}')).toMatchObject({ ok: false });
    expect(parseTermAction('{"action":"run"}')).toMatchObject({ ok: false, error: expect.stringContaining("command") });
    expect(parseTermAction("no json")).toMatchObject({ ok: false });
  });
});

describe("research agent", () => {
  it("remaps the research run's local [n] onto the session's shared numbering", async () => {
    const src = (n: number, url: string) => ({ n, host: new URL(url).hostname, url, title: url, snippet: "s", publishedDate: null, provider: "tavily" as const, score: null });
    const session = mkSession({ sources: [{ ...src(1, "https://old.example/x") }] });
    const deps = mkDeps(scripted(["x"]).open, {
      research: async function* () {
        yield { kind: "step" as const, id: "search-tavily", label: "Searched", state: "ok" as const, detail: "2 results" };
        yield { kind: "sources" as const, sources: [src(1, "https://new.example/a"), src(2, "https://old.example/x")] };
        yield { kind: "reasoning" as const, delta: "hm" };
        yield { kind: "answer" as const, delta: "A [1] and B [2]." };
        yield { kind: "done" as const, used: [1, 2], provider: "groq" as const, model: "m", ms: 5 };
      },
    });
    const { ev, ret } = await collect(runResearchAgent(ctx("research-1", deps, session), "q"));
    expect(ret).toBe("A [2] and B [1].");
    expect(session.sources.map((s) => [s.n, s.host])).toEqual([[1, "old.example"], [2, "new.example"]]);
    expect(ev.map((e) => e.kind)).toEqual(["step", "visit", "visit", "visit", "reasoning", "sources", "file", "file"]);
    expect(ev.filter((e) => e.kind === "visit").map((e) => e.kind === "visit" && `${e.action}:${e.via}:${e.label}`)).toEqual(["search:tavily:q", "read:tavily:new.example", "read:tavily:old.example"]);
    // the findings are written down as files the next step can read
    expect(Object.keys(session.files)).toEqual(["artifacts/research-1-sources.csv", "artifacts/research-1-notes.md"]);
    expect(session.files["artifacts/research-1-sources.csv"]).toContain("https://new.example/a");
    expect(session.files["artifacts/research-1-notes.md"]).toContain("A [2] and B [1].");
  });
  it("returns a readable failure when the research run errors", async () => {
    const deps = mkDeps(scripted(["x"]).open, { research: async function* () { yield { kind: "error" as const, message: "No web results" }; } });
    expect((await collect(runResearchAgent(ctx("research-1", deps), "q"))).ret).toBe("Research failed: No web results");
  });
});
