import { describe, expect, it } from "vitest";
import { findRun, modelName, noModelsNote, reportFor, tally } from "./agent-report";
import type { CEvent } from "./events";
import { applyCEvent, newRun, type Run } from "./run";

const fold = (id: string, ...e: CEvent[]): Run => e.reduce(applyCEvent, newRun(id, "q"));
const agent = (id: string, role: "research" | "terminal" | "browser" = "research", o: Partial<Extract<CEvent, { kind: "agent" }>> = {}): CEvent => ({ kind: "agent", id, role, title: id, state: "running", ...o });
const use = (a: string, prompt: number, completion: number, o: Partial<Extract<CEvent, { kind: "usage" }>> = {}): CEvent => ({ kind: "usage", agent: a, prompt, completion, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq", exact: true, ...o });
const page = (a: string, url: string, title = "T"): CEvent => ({ kind: "visit", agent: a, id: `read:${url}`, action: "read", label: new URL(url).hostname, url, title, via: "tavily", state: "ok" });
const search = (a: string, q: string, count = 6): CEvent => ({ kind: "visit", agent: a, id: `${a}:s`, action: "search", label: q, via: "tavily", state: "ok", count });

describe("reportFor", () => {
  it("is null for an agent the run does not have", () => expect(reportFor(newRun("r", "q"), "research-1")).toBeNull());

  it("gathers the task, the result, the models, the tally and the reasoning of a researcher", () => {
    const run = fold("r",
      { kind: "message", id: "to-research-1", from: "main", to: "research-1", text: "Find Adyen's fee page" },
      agent("research-1"),
      { kind: "reasoning", agent: "research-1", delta: "I should look at the pricing page." },
      search("research-1", "adyen fees", 6),
      page("research-1", "https://adyen.com/pricing", "Pricing"), page("research-1", "https://docs.adyen.com/fees", "Fees"), page("research-1", "https://adyen.com/pricing/", "Pricing again"),
      use("research-1", 800, 120), use("research-1", 900, 60, { model: "openai/gpt-oss-20b" }), use("research-1", 700, 40),
      { kind: "message", id: "from-research-1", from: "research-1", to: "main", text: "Adyen charges 0.60 EUR plus 11 cents" },
      agent("research-1", "research", { state: "ok", ms: 2200 }),
    );
    const r = reportFor(run, "research-1")!;
    expect(r.task).toBe("Find Adyen's fee page");
    expect(r.result).toBe("Adyen charges 0.60 EUR plus 11 cents");
    expect(r.models).toEqual([
      { model: "openai/gpt-oss-120b", provider: "groq", calls: 2, prompt: 1500, completion: 160, exact: true },
      { model: "openai/gpt-oss-20b", provider: "groq", calls: 1, prompt: 900, completion: 60, exact: true },
    ]);
    expect([r.calls, r.tokensIn, r.tokensOut]).toEqual([3, 2400, 220]);
    expect(r.searches).toHaveLength(1);
    expect(r.pages).toBe(2); // the same page with a trailing slash is one page
    expect(r.hosts.map((h) => h.host)).toEqual(["adyen.com", "docs.adyen.com"]);
    expect(r.pageRows.map((x) => [x.host, x.title, x.n])).toEqual([["adyen.com", "Pricing", null], ["docs.adyen.com", "Fees", null]]);
    expect(r.thoughtChars).toBe("I should look at the pricing page.".length);
    expect(tally(r)).toEqual(["3 model calls", "1 search", "2 pages read"]);
  });

  it("gives each page the number the answer cites it by, matching trailing slashes and tracking noise", () => {
    const src = (n: number, url: string) => ({ n, host: new URL(url).hostname, url, title: "t", snippet: "s", publishedDate: null, provider: "tavily" as const, score: null });
    const run = fold("r", agent("research-1"), page("research-1", "https://adyen.com/pricing/", "Pricing"), page("research-1", "https://other.com/z", "Other"), { kind: "sources", sources: [src(3, "https://adyen.com/pricing")] });
    expect(reportFor(run, "research-1")!.pageRows.map((x) => [x.host, x.n])).toEqual([["adyen.com", 3], ["other.com", null]]);
  });
  it("lists the commands a terminal agent ran, with their output and exit codes", () => {
    const run = fold("r", agent("terminal-1", "terminal"),
      { kind: "term", agent: "terminal-1", id: "t1", command: "curl -sL https://stripe.com/pricing -o s.html", state: "running" },
      { kind: "term", agent: "terminal-1", id: "t1", command: "curl -sL https://stripe.com/pricing -o s.html", state: "ok", out: "ok\n", exit: 0, ms: 900 },
      { kind: "term", agent: "terminal-1", id: "t2", command: "grep -c fee s.html", state: "error", out: "", exit: 1, ms: 20 },
    );
    const r = reportFor(run, "terminal-1")!;
    expect(r.commands.map((c) => [c.command, c.exit])).toEqual([["curl -sL https://stripe.com/pricing -o s.html", 0], ["grep -c fee s.html", 1]]);
    expect(tally(r)).toEqual(["2 commands"]);
  });

  it("does not mix in what another agent did", () => {
    const run = fold("r", agent("research-1"), agent("research-2"), page("research-1", "https://a.com/x"), page("research-2", "https://b.com/y"), use("research-1", 100, 10), use("research-2", 200, 20, { model: "m/other" }));
    expect(reportFor(run, "research-1")!.models.map((m) => m.model)).toEqual(["openai/gpt-oss-120b"]);
    expect(reportFor(run, "research-2")!.hosts.map((h) => h.host)).toEqual(["b.com"]);
  });

  it("gives the browser agent the pages the stream tagged just 'browser'", () => {
    const run = fold("r", agent("browser-1", "browser"), { kind: "page", url: "https://stripe.com/pricing", title: "Stripe pricing" });
    expect(reportFor(run, "browser-1")!.pages).toBe(1);
  });

  it("lists who reports to it", () => {
    const run = fold("r", agent("superpal-stripe", "research"), agent("research-sp-stripe", "research", { parent: "superpal-stripe" }));
    expect(reportFor(run, "superpal-stripe")!.helpers.map((h) => h.id)).toEqual(["research-sp-stripe"]);
  });

  it("says it is thinking only while its call is live and it is still running", () => {
    const live: CEvent = { kind: "usage_live", agent: "browser-1", prompt: 900, completion: 40, window: 131_072, model: "openai/gpt-oss-120b", provider: "groq" };
    expect(reportFor(fold("r", agent("browser-1", "browser"), live), "browser-1")!.thinking).toBe(true);
    expect(reportFor(fold("r", agent("browser-1", "browser"), live, agent("browser-1", "browser", { state: "ok" })), "browser-1")!.thinking).toBe(false);
  });
});

describe("findRun", () => {
  it("picks the latest turn that has the agent, because ids repeat in every turn", () => {
    const a = fold("a", agent("research-1"));
    const b = fold("b", agent("research-1"));
    const c = fold("c", agent("browser-1", "browser"));
    expect(findRun([a, b, c], "research-1")?.id).toBe("b");
    expect(findRun([a, b, c], "nope")).toBeUndefined();
  });
});

describe("tally and notes", () => {
  it("lists only what was done, and falls back to the steps", () => {
    const run = fold("r", agent("x"), { kind: "step", agent: "x", id: "s1", label: "Did a thing", state: "ok" }, { kind: "step", agent: "x", id: "s2", label: "Did another", state: "ok" });
    expect(tally(reportFor(run, "x")!)).toEqual(["2 steps"]);
    expect(tally(reportFor(fold("r", agent("y")), "y")!)).toEqual([]);
  });
  it("names a model without its vendor prefix, with its provider", () => expect(modelName({ model: "nvidia/nemotron-3-ultra-550b-a55b", provider: "bluesminds" })).toBe("nemotron-3-ultra-550b-a55b · bluesminds"));
  it("explains an empty model list by what the agent is", () => {
    expect(noModelsNote(reportFor(fold("r", agent("x")), "x")!)).toBe("Waiting for its first model call.");
    expect(noModelsNote(reportFor(fold("r", agent("x", "research", { state: "ok" })), "x")!)).toBe("No model call. This Pal worked as a script.");
  });
});
