import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/computer/artifacts";
import type { Entry } from "./explain";
import { judgeOrder } from "./judge";
import { fallbackFinalText, reportMarkdown, scoresCsv } from "./report";
import type { Facts, Outcome } from "./types";

const f = (cited: number): Facts => ({ sources: cited, cited, roles: ["research"], files: 0, failed: false });
const out = (h: string): Outcome => ({ headline: h, prediction: "fee 2.9%", confidence: 0.8, recommendation: "use it", evidence: [{ claim: "fee page", source: "stripe.com" }], risks: ["fx"] });
const d = (n: number) => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n });
const E = (id: string, name: string, total: number, n: number | null, o: Outcome | null): Entry => ({ id, name, outcome: o, facts: f(3), sources: [], score: { id, det: 5, llm: n, dims: n === null ? null : d(n), total, weakness: n === 5 ? "thin" : undefined } });
const entries = [E("a", "Rigorist", 8, 9, out("Stripe")), E("b", "Skeptic", 6, 5, out("Square")), E("c", "Maximalist", 4, null, null)];

describe("reportMarkdown", () => {
  const md = reportMarkdown({ title: "Battle report", mode: "battle", question: "Which rail?", entries, winnerId: "a", final: { winner: "a", text: "BEST OUTCOME: use Stripe", provenance: [], why: "", judge: "openai" }, judgeWhy: "better sourced" });
  it("names the winner with the reasons, the combined outcome and the table", () => {
    expect(md).toContain("# Battle report");
    expect(md).toContain("## Winner: Rigorist (8/10)");
    expect(md).toContain("- The blind judge's reason: better sourced");
    expect(md).toContain("## Combined outcome\n\nBEST OUTCOME: use Stripe");
    expect(md).toContain("| Rigorist | 8 | 5 | 9 | 9 | 9 | 9 | 9 | 9 |");
    expect(md).toContain("| Maximalist | 4 | 5 | – | – |");
  });
  it("lists every contender's own lines, including one with no report", () => {
    expect(md).toContain("### Rigorist (winner)");
    expect(md).toContain("- Evidence: fee page (stripe.com)");
    expect(md).toContain("- Judge's note: thin");
    expect(md).toContain("### Maximalist\n\n_No report._");
  });
  it("a loop talks about rounds", () => expect(reportMarkdown({ title: "t", mode: "loop", question: "q?", entries, winnerId: "a", final: null })).toContain("| Round | Total |"));
});

describe("scoresCsv", () => {
  it("best first, winner marked, blanks where there was no judge or report", () => {
    const rows = parseCsv(scoresCsv(entries, "a"));
    expect(rows[0].slice(0, 5)).toEqual(["name", "winner", "total", "counted", "judged"]);
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([["Rigorist", "yes"], ["Skeptic", ""], ["Maximalist", ""]]);
    expect(rows[3][4]).toBe("");
  });
  it("a formula in a headline cannot execute", () => {
    expect(scoresCsv([E("a", "A", 1, 1, out("=HYPERLINK(1)"))], "a")).toContain("'=HYPERLINK(1)");
  });
});

describe("fallbackFinalText", () => {
  it("uses the winner's own outcome in the same sections", () => {
    const t = fallbackFinalText(entries[0]);
    expect(t).toContain("BEST OUTCOME: Stripe. Prediction (80% confidence): fee 2.9%");
    expect(t).toContain("WHY IT WON: highest total score (8 out of 10).");
    expect(t).toContain("WATCH OUT FOR: fx.");
  });
  it("a winner with no report still gives an answer", () => expect(fallbackFinalText(entries[2])).toContain("The winner produced no report."));
});

describe("judgeOrder", () => {
  const fam = (m: string) => m.split("/")[0];
  const models = [{ model: "openai/a" }, { model: "nvidia/b" }, { model: "openai/c" }, { model: "meta/d" }];
  it("puts the families that wrote the fewest reports first and keeps every model", () => {
    expect(judgeOrder(models, ["openai", "openai", "nvidia"], fam).map((m) => m.model)).toEqual(["meta/d", "nvidia/b", "openai/a", "openai/c"]);
  });
  it("with no contenders the order is unchanged", () => expect(judgeOrder(models, [], fam)).toEqual(models));
});
