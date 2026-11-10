import { describe, expect, it } from "vitest";
import { ChartSpec, admitChart, chartRows, defaultSpec, scorecardLayout, type ChartRow } from "./chart";
import type { ExamCard } from "./card";
import { scoreSuperPals } from "./superpals";

const card = (): ExamCard => ({
  contract: "c", rivals: [], rejected: 0, queries: [], pages: 0, measuredFrom: [],
  superpals: scoreSuperPals({ keysPresent: { WISE_SANDBOX_KEY: true }, values: { fx_quote_present: 1, human_steps_at_capture: 0 } }),
  rows: [
    { archetype: "counterparty", metric: "attacks_missed", bar: { op: "<=", value: 0, provenance: "measured" }, observed: 0, status: "BAR_MET" },
    { archetype: "friction", metric: "buyer_steps", bar: { op: "<=", value: 2, provenance: "analyst" }, observed: 4, status: "BAR_MISSED" },
    { archetype: "identity", metric: "unsigned_agent_actions", bar: { op: "<=", value: 0, provenance: "analyst" }, observed: null, status: "NOT_MEASURABLE" },
  ],
} as unknown as ExamCard);

describe("chart", () => {
  const rows = chartRows(card());
  it("takes every number from the card, by stable id", () => {
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual(["exam:counterparty", "exam:friction", "exam:identity"]);
    expect(rows.find((r) => r.id === "superpal:wise")).toMatchObject({ observed: 1, status: "BAR_MET" });
  });
  it("T13: a spec naming a row that is not in the card is refused", () => {
    expect(admitChart({ kind: "scorecard", title: "t", why: "w", rows: ["exam:friction", "exam:made_up"] }, rows)).toEqual({ ok: false, reason: "unknown row id: exam:made_up" });
  });
  it("T14: the schema has no field for a value, and an extra value field is stripped", () => {
    const s = ChartSpec.parse({ kind: "table", title: "t", why: "w", rows: ["exam:friction"], values: [99], observed: 7 });
    expect(Object.keys(s).sort()).toEqual(["kind", "rows", "title", "why"]);
  });
  it("falls back to a table with fewer than 3 rows or when nothing was measured", () => {
    expect(admitChart({ kind: "scorecard", title: "t", why: "w", rows: ["exam:friction", "exam:identity"] }, rows)).toMatchObject({ ok: true, kind: "table" });
    expect(admitChart({ kind: "scorecard", title: "t", why: "w", rows: ["exam:identity", "superpal:stripe", "superpal:apple"] }, rows)).toMatchObject({ ok: true, kind: "table" });
  });
  it("T15: a row that was not measured is a break (fill null), never a zero-length bar", () => {
    const g = scorecardLayout(rows).find((b) => b.id === "exam:identity")!;
    expect(g.fill).toBeNull();
    expect(g.status).toBe("NOT_MEASURABLE");
  });
  it("a measured zero is a real zero, distinct from a break", () => {
    expect(scorecardLayout(rows).find((b) => b.id === "exam:counterparty")!.fill).toBe(0);
  });
  it("T17: same rows, same geometry, byte for byte", () => {
    expect(JSON.stringify(scorecardLayout(rows))).toBe(JSON.stringify(scorecardLayout(chartRows(card()))));
  });
  it("scales each row to its own max so a 4-step miss shows past its tick", () => {
    const f = scorecardLayout(rows).find((b) => b.id === "exam:friction")!;
    expect(f.fill!).toBeGreaterThan(f.tick!);
  });
  it("the default spec covers every row and is admitted as a scorecard", () => {
    const spec = defaultSpec(card());
    expect(spec.rows).toHaveLength(rows.length);
    expect(admitChart(spec, rows)).toMatchObject({ ok: true, kind: "scorecard" });
  });
  it("no row object can be mistaken for model output: every ChartRow field comes from the card", () => {
    const r: ChartRow = rows[0];
    expect(Object.keys(r).sort()).toEqual(["bar", "group", "id", "label", "observed", "op", "status"]);
  });
});
