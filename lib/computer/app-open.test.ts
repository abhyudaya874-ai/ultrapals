import { describe, expect, it } from "vitest";
import { newsroomCsv, openedSummary, proctorCsv, timelineCsv, verdictsCsv, type VerdictLine } from "./app-data";
import { parseCsv } from "./artifacts";
import { collect, mkDeps, mkSession, scripted } from "./fakes";
import { runMain } from "./main-agent";
import { parseMainAction } from "./main-actions";

const v = (o: Partial<VerdictLine>): VerdictLine => ({ id: "e1", promiseId: "p1", payer: "Ana", title: "Logo", amount: "10.00 USD", state: "open", kind: "WAIT", reason: "FACT_MISSING", consequence: "WAIT", at: "2026-11-01T10:00:00.000Z", ...o });
const input = { prompt: "which promises are waiting?", attachments: [], path: "/", pageContext: null };

describe("app data as CSV", () => {
  it("newsroom lists access and price but never a story body", () => {
    const rows = parseCsv(newsroomCsv([{ slug: "a", title: "A, the story", dek: "d", premium: true, price: "0.01", currency: "USD", published: "2026-01-01" }]));
    expect(rows[0]).toEqual(["slug", "title", "access", "price", "currency", "published", "summary"]);
    expect(rows[1]).toEqual(["a", "A, the story", "premium", "0.01", "USD", "2026-01-01", "d"]);
  });
  it("verdicts neutralise a formula smuggled into a title", () => {
    expect(verdictsCsv([v({ title: "=HYPERLINK(1)" })])).toContain(`'=HYPERLINK(1)`);
  });
  it("timeline keeps each promise once, at its latest verdict, oldest first", () => {
    const rows = parseCsv(timelineCsv([v({ promiseId: "p1", at: "2026-11-01T10:00:00Z" }), v({ id: "e2", promiseId: "p1", at: "2026-11-03T10:00:00Z", state: "captured" }), v({ id: "e3", promiseId: "p2", at: "2026-11-02T10:00:00Z", title: "Site" })]));
    expect(rows.slice(1).map((r) => [r[0], r[4], r[5]])).toEqual([["p2", "open", "2026-11-02T10:00:00Z"], ["p1", "captured", "2026-11-03T10:00:00Z"]]);
  });
  it("proctor jobs show minutes and never-run as empty", () => {
    const p = proctorCsv({ schedules: [{ job: "sandbox_canary", everyMs: 6 * 3_600_000, lastRunMs: null }], runs: [{ job: "sandbox_canary", atMs: 0, status: "baseline", note: "3 checks" }], cases: [] });
    expect(parseCsv(p.jobs)[1]).toEqual(["sandbox_canary", "360", ""]);
    expect(parseCsv(p.events)[1]).toEqual(["run", "sandbox_canary", "1970-01-01T00:00:00.000Z", "baseline: 3 checks"]);
  });
  it("the summary names files and row counts", () => expect(openedSummary("dashboard", [{ name: "app/verdicts.csv", rows: 4 }])).toContain("app/verdicts.csv (4 rows)"));
});

describe("the open action", () => {
  it("parses, and refuses an artifact that does not exist", () => {
    expect(parseMainAction('{"action":"open","artifact":"dashboard"}')).toMatchObject({ ok: true, action: { action: "open", artifact: "dashboard" } });
    expect(parseMainAction('{"action":"open","artifact":"secrets"}').ok).toBe(false);
  });
  it("writes the data into the workspace, opens the tab, and the next planning round can see it", async () => {
    const model = scripted(['{"action":"open","artifact":"dashboard"}', '{"action":"answer","text":"One promise is waiting."}']);
    const deps = mkDeps(model.open, { appData: { articles: () => [], verdicts: async () => [v({})], proctor: () => ({ schedules: [], runs: [], cases: [] }) } });
    const session = mkSession({ vm: null });
    const { ev } = await collect(runMain(session, input, deps));
    expect(session.files["artifacts/app/verdicts.csv"]).toContain("FACT_MISSING");
    const kinds = ev.map((e) => e.kind);
    expect(kinds.indexOf("file")).toBeLessThan(kinds.indexOf("open")); // data first, then the tab
    expect(ev.find((e) => e.kind === "open")).toMatchObject({ artifact: "dashboard", title: "Dashboard" });
    expect(model.prompts[1]).toContain("Opened the dashboard artifact");
    expect(model.prompts[1]).toContain("app/verdicts.csv");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("opening the same artifact twice does not read it again", async () => {
    let reads = 0;
    const model = scripted(['{"action":"open","artifact":"timeline"}', '{"action":"open","artifact":"timeline"}', '{"action":"answer","text":"ok"}']);
    const deps = mkDeps(model.open, { appData: { articles: () => [], verdicts: async () => (reads++, [v({})]), proctor: () => ({ schedules: [], runs: [], cases: [] }) } });
    await collect(runMain(mkSession({ vm: null }), input, deps));
    expect(reads).toBe(1);
    expect(model.prompts[2]).toContain("already open");
  });
  it("a database failure is reported to the planner, not thrown", async () => {
    const model = scripted(['{"action":"open","artifact":"dashboard"}', '{"action":"answer","text":"I could not read the verdicts."}']);
    const deps = mkDeps(model.open, { appData: { articles: () => [], verdicts: async () => { throw new Error("db down"); }, proctor: () => ({ schedules: [], runs: [], cases: [] }) } });
    const { ev } = await collect(runMain(mkSession({ vm: null }), input, deps));
    expect(ev.find((e) => e.kind === "step" && e.state === "error")).toMatchObject({ detail: "db down" });
    expect(model.prompts[1]).toContain("Could not read the dashboard data (db down)");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
});
