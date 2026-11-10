import { describe, expect, it } from "vitest";
import { applyCEvent, newRun } from "./run";
import { findFile, runChart } from "./chart-action";
import { collect, mkDeps, mkSession, scripted } from "./fakes";
import { runMain } from "./main-agent";

const CSV = "rail,fit,risk\nStripe,82,20\nSquare,64,35\nPayPal,71,25\nAdyen,40,10\n";
const files = { "artifacts/rivals.csv": CSV, "artifacts/app/verdicts.csv": "a,b\n1,2\n" };
const ctx = (replies: string[], over: Parameters<typeof mkSession>[0] = {}) => {
  const model = scripted(replies);
  return { model, c: { agent: "main", session: mkSession({ vm: null, files, ...over }), deps: mkDeps(model.open) } };
};
const chartOf = (ev: Awaited<ReturnType<typeof collect>>["ev"]) => ev.find((e) => e.kind === "chart") as Extract<(typeof ev)[number], { kind: "chart" }> | undefined;

describe("findFile", () => {
  it.each([["artifacts/rivals.csv", "artifacts/rivals.csv"], ["rivals.csv", "artifacts/rivals.csv"], ["/workspace/artifacts/rivals.csv", "artifacts/rivals.csv"], ["verdicts.csv", "artifacts/app/verdicts.csv"], ["app/verdicts.csv", "artifacts/app/verdicts.csv"]])("%s", (n, want) => expect(findFile(files, n)?.path).toBe(want));
  it("returns null for a file that does not exist", () => expect(findFile(files, "nope.csv")).toBeNull());
});

describe("the chart action", () => {
  it("lets the model pick the chart and the columns, and draws the file's own numbers", async () => {
    const { c, model } = ctx(['{"type":"radar","x":"rail","y":["fit","risk"],"title":"Rails compared","why":"two scores per rail on one scale"}']);
    const { ev, ret } = await collect(runChart(c, "rivals.csv", "compare the rails"));
    expect(chartOf(ev)).toMatchObject({ spec: { type: "radar", x: "rail", y: ["fit", "risk"], title: "Rails compared" }, source: "artifacts/rivals.csv" });
    expect(chartOf(ev)!.spec.data[0]).toEqual({ rail: "Stripe", fit: 82, risk: 20 });
    expect(chartOf(ev)!.note).toBeUndefined();
    expect(model.prompts[0]).toContain("fit (number, 40 to 82)");
    expect(ret).toContain("Drew a radar chart");
    expect(ret).toContain("two scores per rail");
  });
  it("replaces a choice that does not fit the data, and says so", async () => {
    const { c } = ctx(['{"type":"candlestick","x":"rail","y":["fit","risk"],"why":"looks fancy"}']);
    const { ev, ret } = await collect(runChart(c, "rivals.csv", "compare"));
    const ch = chartOf(ev)!;
    expect(ch.spec.type).not.toBe("candlestick");
    expect(ch.note).toMatch(/candlestick chart did not fit/);
    expect(ret).toContain("Note:");
  });
  it("falls back to the rule-based pick when the model gives nothing usable", async () => {
    const { c } = ctx(["I would use a bar chart!"]);
    const { ev, ret } = await collect(runChart(c, "rivals.csv", "compare"));
    expect(chartOf(ev)).toBeDefined();
    expect(ret).toContain("chosen by rule");
  });
  it("falls back to the rule when the model is down", async () => {
    const down = mkDeps((async () => ({ ok: false, degraded: true, reason: "http 500" })) as never);
    const { ev } = await collect(runChart({ agent: "main", session: mkSession({ vm: null, files }), deps: down }, "rivals.csv", "compare"));
    expect(chartOf(ev)).toBeDefined();
  });
  it("tells the planner which files exist when the name is wrong", async () => {
    const { c } = ctx(["x"]);
    const { ev, ret } = await collect(runChart(c, "ghost.csv", "anything"));
    expect(chartOf(ev)).toBeUndefined();
    expect(ret).toContain("artifacts/rivals.csv");
    expect(ev.find((e) => e.kind === "step")).toMatchObject({ state: "error", detail: "no such file" });
  });
  it("a file with only a header has nothing to chart", async () => {
    const { c } = ctx(["x"], { files: { "artifacts/empty.csv": "a,b\n" } });
    const { ret } = await collect(runChart(c, "empty.csv", "anything"));
    expect(ret).toContain("no data rows");
  });
  it("the reducer keeps the chart on the run, once per id", () => {
    const ev = { kind: "chart" as const, agent: "main", id: "c1", spec: { type: "bar" as const, x: "a", y: ["b"], data: [{ a: "x", b: 1 }] }, source: "artifacts/r.csv" };
    const run = [ev, ev].reduce(applyCEvent, newRun("r", "p"));
    expect(run.charts).toHaveLength(1);
    expect(run.charts![0]).toMatchObject({ id: "c1", source: "artifacts/r.csv" });
  });
  it("UltraPal can ask for it as an action, and the planner is told what was drawn", async () => {
    const model = scripted(['{"action":"chart","file":"rivals.csv","question":"which rail is best"}', '{"type":"bar","x":"rail","y":["fit"],"why":"one measure across four rails"}', '{"action":"answer","text":"Stripe leads."}']);
    const { ev } = await collect(runMain(mkSession({ vm: null, files }), { prompt: "chart the rails", attachments: [], path: "/", pageContext: null }, mkDeps(model.open)));
    expect(chartOf(ev)?.spec.type).toBe("bar");
    expect(model.prompts[2]).toContain("Drew a bar chart of artifacts/rivals.csv");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
});
