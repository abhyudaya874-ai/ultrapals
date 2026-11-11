import { describe, expect, it } from "vitest";
import { resumeTask } from "@/lib/browse/handoff";
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
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://a.example", "A", "the page says hello, and carries enough text to count as a page that has loaded")) } });
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(stepsOf(ev).map((s) => s.detail ?? s.state).filter((d) => d !== "running")).toEqual([expect.stringContaining("payments are not available"), "repeated"]);
    expect(model.prompts[2]).toContain("REPEAT:");
    expect(ret).toContain("kept repeating");
    expect(ret).toContain("the page says hello");
  });
  it("stops at the step budget when every step differs", async () => {
    const replies = Array.from({ length: 14 }, (_, i) => `{"action":"goto","url":"https://a.example/${i}"}`);
    const deps = mkDeps(scripted(replies).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")), goto: async () => ok(null) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", deps), "t"))).ret).toContain("used all 12 steps");
  });
  it("starts the VM once and announces the live view; a missing VM is a clean failure", async () => {
    const deps = mkDeps(scripted(['{"action":"finish","answer":"x"}']).open, { vm: { snapshot: async () => ok(page("https://a.example", "A")) } });
    const { ev } = await collect(runBrowserAgent(ctx("browser-1", deps, mkSession({ vm: null })), "t"));
    expect(ev.find((e) => e.kind === "workspace")).toMatchObject({ liveViewUrl: expect.stringContaining("kernel.sh") });
    const none = mkDeps(scripted(["x"]).open, { vm: { open: async () => ({ ok: false as const, degraded: true as const, reason: "kernel off" }) } });
    expect((await collect(runBrowserAgent(ctx("browser-1", none, mkSession({ vm: null })), "t"))).ret).toBe("I could not start the browser.");
  });
});

describe("browser agent: acting like a person in a real browser", () => {
  const base = (over: Record<string, unknown> = {}) => ({ snapshot: async () => ok(page("https://g.example/", "G", "text", [{ i: 0, tag: "textarea", label: "Search", x: 1, y: 1 }])), ...over });
  it("searches ON a site: types into its box with Enter, scrolls, presses a key, goes back", async () => {
    const model = scripted(['{"action":"type","index":0,"text":"kiro","submit":true}', '{"action":"scroll","direction":"down"}', '{"action":"key","key":"PageDown"}', '{"action":"back"}', '{"action":"finish","answer":"Saw the results for kiro."}']);
    const did: string[] = [];
    const deps = mkDeps(model.open, { vm: base({
      type: async (_b: unknown, el: { i: number }, text: string, submit: boolean) => (did.push(`type ${el.i} ${text} ${submit}`), ok(null)),
      scroll: async (_b: unknown, d: string, to?: string) => (did.push(`scroll ${d} ${to ?? ""}`.trim()), ok(null)),
      key: async (_b: unknown, k: string) => (did.push(`key ${k}`), ok(null)),
      navigate: async (_b: unknown, op: string) => (did.push(op), ok(null)),
    }) });
    const { ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "search kiro in google then scroll"));
    expect(ret).toBe("Saw the results for kiro.");
    expect(did).toEqual(["type 0 kiro true", "scroll down", "key PageDown", "back"]);
  });
  it("tells the model what its last action changed", async () => {
    const urls = ["https://g.example/", "https://g.example/search?q=kiro", "https://g.example/search?q=kiro"];
    let i = 0;
    const model = scripted(['{"action":"type","index":0,"text":"kiro","submit":true}', '{"action":"scroll","direction":"down"}', '{"action":"finish","answer":"ok"}']);
    const deps = mkDeps(model.open, { vm: base({ snapshot: async () => { const k = Math.min(i++, 2); return ok({ ...page(urls[k], "G", `text ${k}`, [{ i: 0, tag: "textarea", label: "Search", x: 1, y: 1 }]), scroll: { y: k === 2 ? 600 : 0, height: 2400, view: 800 } }); }, type: async () => ok(null), scroll: async () => ok(null) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(model.prompts[1]).toContain("the browser is now on https://g.example/search?q=kiro");
    expect(model.prompts[2]).toContain("scrolled from 0 to 600 px");
    expect(model.prompts[2]).toContain("scrolled 600 of 2400 px");
  });
  it("says so when an action changed nothing", async () => {
    const model = scripted(['{"action":"click","index":0}', '{"action":"finish","answer":"ok"}']);
    const deps = mkDeps(model.open, { vm: base({ click: async () => ok(null) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(model.prompts[1]).toContain("nothing visible changed");
  });
  it("find reports the text around the match, or that it is not there", async () => {
    const model = scripted(['{"action":"find","text":"pricing"}', '{"action":"find","text":"zzz"}', '{"action":"finish","answer":"ok"}']);
    const deps = mkDeps(model.open, { vm: base({ find: async (_b: unknown, t: string) => ok(t === "pricing" ? { found: true, context: "Pricing starts at $20 a month." } : { found: false, context: "" }) }) });
    const { ev } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(model.prompts[1]).toContain("found it: Pricing starts at $20 a month.");
    expect(model.prompts[2]).toContain('ERROR: "zzz" is not on this page');
    expect(stepsOf(ev).find((s) => s.label.includes("zzz") && s.state === "error")?.detail).toContain("not on this page");
  });
  it("scrolling down twice is two different moves, not a repeat", async () => {
    const model = scripted(['{"action":"scroll"}', '{"action":"scroll"}', '{"action":"scroll"}', '{"action":"finish","answer":"scrolled"}']);
    let y = 0;
    const deps = mkDeps(model.open, { vm: base({ snapshot: async () => ok({ ...page("https://g.example/", "G"), scroll: { y, height: 5000, view: 800 } }), scroll: async () => { y += 600; return ok(null); } }) });
    expect((await collect(runBrowserAgent(ctx("browser-1", deps), "t"))).ret).toBe("scrolled");
  });
  it("a task typed in the browser's own box may take more steps than a delegated one", async () => {
    const replies = Array.from({ length: 30 }, (_, i) => `{"action":"goto","url":"https://a.example/${i}"}`);
    const deps = mkDeps(scripted(replies).open, { vm: base({ goto: async () => ok(null) }) });
    expect((await collect(runBrowserAgent({ ...ctx("browser-1", deps), maxSteps: 20 }, "t"))).ret).toContain("used all 20 steps");
  });
  it("reports a failed page load as an error step the model can read", async () => {
    const model = scripted(['{"action":"goto","url":"https://nope.example/"}', '{"action":"finish","answer":"could not open it"}']);
    const deps = mkDeps(model.open, { vm: base({ goto: async () => ({ ok: false as const, degraded: true as const, reason: "net::ERR_NAME_NOT_RESOLVED at https://nope.example/" }) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(model.prompts[1]).toContain("ERROR: net::ERR_NAME_NOT_RESOLVED");
  });
  it("starts a new cloud computer when Kernel has deleted the old one", async () => {
    let opened = 0;
    const model = scripted(['{"action":"finish","answer":"fine"}']);
    const deps = mkDeps(model.open, { vm: base({ alive: async () => false, open: async () => (opened++, ok({ id: "vm-2", liveViewUrl: "https://b.kernel.sh:8443/browser/live/U", offX: 0, offY: 0 })) }) });
    const session = mkSession({ vmCheckedAt: 0 });
    const { ev } = await collect(runBrowserAgent(ctx("browser-1", deps, session), "t"));
    expect(opened).toBe(1);
    expect(session.vm?.id).toBe("vm-2");
    expect(ev.find((e) => e.kind === "workspace")).toMatchObject({ liveViewUrl: expect.stringContaining("b.kernel.sh") });
    expect(stepsOf(ev).some((s) => s.label.includes("had closed") )).toBe(true);
  });
  it("does not ask Kernel again for a browser it checked a moment ago", async () => {
    let asked = 0;
    const deps = mkDeps(scripted(['{"action":"finish","answer":"x"}']).open, { vm: base({ alive: async () => (asked++, true) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps, mkSession({ vmCheckedAt: Date.now() })), "t"));
    expect(asked).toBe(0);
    await collect(runBrowserAgent(ctx("browser-1", deps, mkSession({ vmCheckedAt: Date.now() - 60_000 })), "t"));
    expect(asked).toBe(1);
  });
  it("waits once for a page that has drawn nothing yet, then reads what appeared (no model call spent on an empty view)", async () => {
    const model = scripted(['{"action":"finish","answer":"read it"}']);
    let seen = 0;
    let waited = 0;
    const deps = mkDeps(model.open, { vm: base({ snapshot: async () => ok(seen++ === 0 ? page("https://app.example/", "", "") : page("https://app.example/", "App", "Dashboard with twelve widgets and a long enough text to count as a loaded page.")), wait: async () => (waited++, ok(null)) }) });
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(ret).toBe("read it");
    expect(waited).toBe(1);
    expect(stepsOf(ev).some((s) => s.label === "Waiting for the page to load" && s.state === "ok")).toBe(true);
    expect(model.prompts[0]).toContain("Dashboard with twelve widgets");
  });
  it("does not wait again on the same address, and never on a page that already has content", async () => {
    const model = scripted(['{"action":"scroll"}', '{"action":"finish","answer":"x"}']);
    let waited = 0;
    const blank = page("https://app.example/", "", "");
    const deps = mkDeps(model.open, { vm: base({ snapshot: async () => ok(blank), scroll: async () => ok(null), wait: async () => (waited++, ok(null)) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(waited).toBe(1); // two looks at the same empty page, one wait
    waited = 0;
    const full = mkDeps(scripted(['{"action":"finish","answer":"x"}']).open, { vm: base({ wait: async () => (waited++, ok(null)) }) });
    await collect(runBrowserAgent(ctx("browser-1", full), "t"));
    expect(waited).toBe(0);
  });
  it("a model whose reply is not an action costs no step: the next model answers the same step", async () => {
    const model = scripted(["Sure! I will click the button now.", '{"action":"finish","answer":"done"}']);
    const two = { model: { models: [{ provider: "groq" as const, model: "openai/gpt-oss-20b" }, { provider: "groq" as const, model: "openai/gpt-oss-120b" }], rotate: false } };
    const deps = mkDeps(model.open, { ...two, vm: base() });
    const { ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(ret).toBe("done");
    expect(model.calls()).toBe(2);
    expect(model.prompts[1]).not.toContain("(unusable reply)"); // it was never a step the model had to be told about
  });
  it("keeps the notes the model writes, and shows them on every later page", async () => {
    const model = scripted(['{"note":"Plan A costs $20 (a.example)","action":"scroll"}', '{"note":"Plan B costs $30 (b.example)","action":"scroll","direction":"up"}', '{"action":"finish","answer":"A is cheaper"}']);
    const deps = mkDeps(model.open, { vm: base({ scroll: async () => ok(null) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "compare plans"));
    expect(model.prompts[0]).not.toContain("YOUR NOTES (written");
    expect(model.prompts[1]).toContain("YOUR NOTES (written by you on earlier pages):\nPlan A costs $20 (a.example)\n\nSOURCES");
    expect(model.prompts[2]).toContain("Plan A costs $20 (a.example)\nPlan B costs $30 (b.example)");
  });
  it("shows the model its own recent reasoning, so a later step does not forget why an earlier one was taken", async () => {
    const model = scripted(['{"thought":"the price is below the fold","action":"scroll","direction":"down"}', '{"action":"finish","answer":"ok"}']);
    const deps = mkDeps(model.open, { vm: base({ scroll: async () => ok(null) }) });
    await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(model.prompts[1]).toContain("the price is below the fold");
  });
});

describe("browser agent: when a person is needed", () => {
  const SORRY = page("https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dkiro", "https://www.google.com/search?q=kiro", "About this page\nOur systems have detected unusual traffic from your computer network. This page checks to see if it's really you sending the requests, and not a robot.");
  const LOGIN = { ...page("https://github.com/login", "Sign in to GitHub", "Username or email address\nPassword"), elements: [{ i: 0, tag: "input", type: "text", label: "Username", x: 1, y: 1 }, { i: 1, tag: "input", type: "password", label: "password", x: 1, y: 2 }] };
  const watched = (d: ReturnType<typeof mkDeps>, session = mkSession()) => ({ agent: "browser-1", session, deps: d, interactive: true });

  it("stops at a CAPTCHA without asking a model, tells the UI, and remembers the task and what was already done", async () => {
    const model = scripted(['{"action":"type","index":0,"text":"kiro","submit":true}']);
    const pages = [page("https://www.google.com/", "Google", "search", [{ i: 0, tag: "textarea", label: "Search", x: 1, y: 1 }]), SORRY];
    let i = 0;
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(pages[Math.min(i++, 1)]), type: async () => ok(null) } });
    const session = mkSession();
    const { ev, ret } = await collect(runBrowserAgent(watched(deps, session), "search google for kiro and scroll"));
    expect(ret).toMatch(/^NEEDS_HUMAN: google\.com is showing a security check/);
    expect(model.calls()).toBe(1); // the typing step; the CAPTCHA page itself cost no model call
    expect(ev.find((e) => e.kind === "handoff")).toMatchObject({ agent: "browser-1", need: "captcha", url: expect.stringContaining("/sorry/") });
    expect(session.handoff).toMatchObject({ agent: "browser", task: "search google for kiro and scroll", kind: "captcha", notes: ['Typing "kiro" into [0] Search and pressing Enter'] });
    expect(stepsOf(ev).some((s) => s.label === "Waiting for you" && s.state === "ok")).toBe(true);
  });
  it("what the agent wrote down survives the pause, and is handed back to it when it continues", async () => {
    const model = scripted(['{"note":"Plan A costs $20 (a.example)","action":"type","index":0,"text":"kiro","submit":true}']);
    const pages = [page("https://www.google.com/", "Google", "search", [{ i: 0, tag: "textarea", label: "Search", x: 1, y: 1 }]), SORRY];
    let i = 0;
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(pages[Math.min(i++, 1)]), type: async () => ok(null) } });
    const session = mkSession();
    await collect(runBrowserAgent(watched(deps, session), "compare prices"));
    expect(session.handoff?.found).toBe("Plan A costs $20 (a.example)");
    expect(resumeTask(session.handoff!, "")).toContain("What you had already written down");
    expect(resumeTask(session.handoff!, "")).toContain("Plan A costs $20 (a.example)");
  });
  it("a run nobody is watching does not wait: it reports the wall as a result", async () => {
    const model = scripted(['{"action":"finish","answer":"x"}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(SORRY) } });
    const session = mkSession();
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps, session), "t"));
    expect(ret).toMatch(/^Blocked: google\.com is showing a security check.*Nobody is available/);
    expect(ev.some((e) => e.kind === "handoff")).toBe(false);
    expect(session.handoff).toBeUndefined();
    expect(model.calls()).toBe(0);
  });
  describe("continuing after the person helped", () => {
    const PAUSE = { agent: "browser" as const, task: "search google for kiro ide pricing and name the first result", reason: "google.com is showing a security check (a CAPTCHA). Solve it in the browser.", kind: "captcha" as const, url: "https://www.google.com/sorry/index?continue=x", notes: ["Opening https://www.google.com", 'Typing "kiro ide pricing" into [7] Search and pressing Enter'], visited: ["https://www.google.com/", "https://www.google.com/sorry/index?continue=x"], at: 1000 };
    const RESULTS = page("https://duckduckgo.com/?q=kiro+ide+pricing", "kiro ide pricing at DuckDuckGo", "Kiro pricing: Free, Pro $20 a month, Pro+ $40 a month. Kiro is an agentic IDE from AWS.");
    const resumedCtx = (d: ReturnType<typeof mkDeps>, session = mkSession()) => ({ agent: "browser-1", session, deps: d, interactive: true, resumed: PAUSE });

    it("starts from the steps already taken, and says where the person left the browser", async () => {
      const model = scripted(['{"action":"finish","answer":"Free, Pro $20, Pro+ $40."}']);
      const { ret } = await collect(runBrowserAgent(resumedCtx(mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS) } })), "the task"));
      expect(ret).toBe("Free, Pro $20, Pro+ $40.");
      expect(model.prompts[0]).toContain("0. Opening https://www.google.com => done before the pause");
      expect(model.prompts[0]).toContain('0. Typing "kiro ide pricing" into [7] Search and pressing Enter => done before the pause');
      expect(model.prompts[0]).toContain("it is now on https://duckduckgo.com/?q=kiro+ide+pricing");
      expect(model.prompts[0]).toContain("you stopped at https://www.google.com/sorry/index?continue=x");
    });
    it("if the person left the browser where it was, it says so", async () => {
      const model = scripted(['{"action":"finish","answer":"ok"}']);
      const same = page("https://shop.example/cart", "Cart", "A page with enough text on it for the agent not to wait for it to finish loading in the browser.");
      const c = { ...resumedCtx(mkDeps(model.open, { vm: { snapshot: async () => ok(same) } })), resumed: { ...PAUSE, url: "https://shop.example/cart?x=1", kind: "asked" as const } };
      await collect(runBrowserAgent(c, "the task"));
      expect(model.prompts[0]).toContain("it is still on the page you stopped at");
    });
    it("does not go back to where the task began: the first time it tries, it is told the person moved the browser on; the second time it is let", async () => {
      const model = scripted(['{"action":"goto","url":"https://www.google.com"}', '{"action":"goto","url":"https://www.google.com/"}', '{"action":"finish","answer":"done"}']);
      const opened: string[] = [];
      const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS), goto: async (_b: unknown, u: string) => (opened.push(u), ok(null)) } });
      const { ev } = await collect(runBrowserAgent(resumedCtx(deps), "the task"));
      expect(model.prompts[1]).toContain("ERROR: you already opened https://www.google.com before the pause, and the browser has since moved on to https://duckduckgo.com/?q=kiro+ide+pricing");
      expect(opened).toEqual(["https://www.google.com/"]); // refused once, then allowed
      expect(stepsOf(ev).filter((s) => s.state === "error")).toHaveLength(1);
    });
    it("may open a page it had not visited, or one it is still on, without being questioned", async () => {
      const model = scripted(['{"action":"goto","url":"https://kiro.dev/pricing"}', '{"action":"finish","answer":"done"}']);
      const opened: string[] = [];
      const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS), goto: async (_b: unknown, u: string) => (opened.push(u), ok(null)) } });
      await collect(runBrowserAgent(resumedCtx(deps), "the task"));
      expect(opened).toEqual(["https://kiro.dev/pricing"]);
    });
    it("a second pause keeps the whole trail: the steps before it, and the pages visited", async () => {
      const model = scripted(['{"action":"handoff","reason":"Sign in to your account so I can open the billing page."}']);
      const session = mkSession();
      await collect(runBrowserAgent(resumedCtx(mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS) } }), session), "the task"));
      expect(session.handoff?.notes).toEqual(PAUSE.notes); // the person's visit is not a step the agent took
      expect(session.handoff?.visited).toEqual([...PAUSE.visited, "https://duckduckgo.com/?q=kiro+ide+pricing"]);
    });
  });
  it("the model can ask for help itself", async () => {
    const model = scripted(['{"action":"click","index":0}', '{"action":"handoff","reason":"Sign in to GitHub so I can open your repository."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(LOGIN), click: async () => ok(null) } });
    const session = mkSession();
    const { ev, ret } = await collect(runBrowserAgent(watched(deps, session), "open my repo"));
    expect(ret).toBe("NEEDS_HUMAN: Sign in to GitHub so I can open your repository.");
    expect(ev.find((e) => e.kind === "handoff")).toMatchObject({ need: "asked", reason: "Sign in to GitHub so I can open your repository." });
    expect(session.handoff).toMatchObject({ kind: "asked", task: "open my repo", reason: "Sign in to GitHub so I can open your repository." });
  });
  it("a sign-in form is pointed out to the model, with the rule never to type credentials", async () => {
    const model = scripted(['{"action":"finish","answer":"ok"}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(LOGIN) } });
    await collect(runBrowserAgent(watched(deps), "read the page"));
    expect(model.prompts[0]).toContain("NOTICE: github.com is asking you to sign in.");
    expect(model.prompts[0]).toContain("must never type any");
  });
  it("an ordinary page gets no notice", async () => {
    const model = scripted(['{"action":"finish","answer":"ok"}']);
    await collect(runBrowserAgent(watched(mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://a.example/", "A", "text")) } })), "t"));
    expect(model.prompts[0]).not.toContain("NOTICE:");
  });
  it("the model's handoff in an unattended run is reported, not waited for", async () => {
    const model = scripted(['{"action":"handoff","reason":"Enter the six digit code from your phone."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://bank.example/", "Bank", "code")) } });
    const { ev, ret } = await collect(runBrowserAgent(ctx("browser-1", deps), "t"));
    expect(ret).toMatch(/^Blocked: Enter the six digit code/);
    expect(ev.some((e) => e.kind === "handoff")).toBe(false);
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
    expect(ev.map((e) => e.kind)).toEqual(["step", "visit", "visit", "visit", "reasoning", "usage", "sources", "file", "file"]);
    // the model that wrote the answer is told, as an estimate, so the agent's panel can name it
    expect(ev.find((e) => e.kind === "usage")).toMatchObject({ agent: "research-1", model: "m", provider: "groq", exact: false });
    const u = ev.find((e) => e.kind === "usage");
    expect(u && u.kind === "usage" && u.prompt).toBeGreaterThan(0);
    expect(u && u.kind === "usage" && u.completion).toBeGreaterThan(0);
    expect(ev.filter((e) => e.kind === "visit").map((e) => e.kind === "visit" && `${e.action}:${e.via}:${e.label}`)).toEqual(["search:tavily:q", "read:tavily:new.example", "read:tavily:old.example"]);
    // the findings are written down as files the next step can read
    expect(Object.keys(session.files)).toEqual(["artifacts/research-1-sources.csv", "artifacts/research-1-notes.md"]);
    expect(session.files["artifacts/research-1-sources.csv"]).toContain("https://new.example/a");
    expect(session.files["artifacts/research-1-notes.md"]).toContain("A [2] and B [1].");
  });
  it("tells the context ring what it has used while it writes, then the finished call", async () => {
    let t = 0;
    const src = { n: 1, host: "a.example", url: "https://a.example/x", title: "A", snippet: "s", publishedDate: null, provider: "tavily" as const, score: null };
    const deps = mkDeps(scripted(["x"]).open, {
      research: async function* () {
        yield { kind: "sources" as const, sources: [src] };
        yield { kind: "model" as const, provider: "groq" as const, model: "openai/gpt-oss-120b" };
        for (let i = 0; i < 5; i++) yield { kind: "answer" as const, delta: `word${i} ` };
        yield { kind: "done" as const, used: [1], provider: "groq" as const, model: "openai/gpt-oss-120b", ms: 5 };
      },
    });
    deps.model.live = true;
    deps.model.now = () => (t += 200); // every read is later than the last report by more than a report interval
    const { ev } = await collect(runResearchAgent(ctx("research-1", deps, mkSession()), "q"));
    const lives = ev.filter((e) => e.kind === "usage_live");
    expect(lives.length).toBeGreaterThan(2);
    expect(lives[0]).toMatchObject({ agent: "research-1", completion: 0, model: "openai/gpt-oss-120b", provider: "groq" });
    const grown = lives.map((e) => (e.kind === "usage_live" ? e.completion : -1));
    expect(grown).toEqual([...grown].sort((a, b) => a - b));
    expect(grown.at(-1)).toBeGreaterThan(0);
    expect(ev.filter((e) => e.kind === "usage")).toHaveLength(1);
    expect(ev.findIndex((e) => e.kind === "usage")).toBeGreaterThan(ev.findLastIndex((e) => e.kind === "usage_live"));
  });
  it("tells nothing live when live reporting is off", async () => {
    const deps = mkDeps(scripted(["x"]).open, {
      research: async function* () {
        yield { kind: "sources" as const, sources: [] };
        yield { kind: "model" as const, provider: "groq" as const, model: "m" };
        yield { kind: "answer" as const, delta: "A." };
        yield { kind: "done" as const, used: [], provider: "groq" as const, model: "m", ms: 5 };
      },
    });
    const { ev } = await collect(runResearchAgent(ctx("research-1", deps, mkSession()), "q"));
    expect(ev.some((e) => e.kind === "usage_live")).toBe(false);
  });
  it("returns a readable failure when the research run errors", async () => {
    const deps = mkDeps(scripted(["x"]).open, { research: async function* () { yield { kind: "error" as const, message: "No web results" }; } });
    expect((await collect(runResearchAgent(ctx("research-1", deps), "q"))).ret).toBe("Research failed: No web results");
  });
});
