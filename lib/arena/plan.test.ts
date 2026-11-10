import { describe, expect, it } from "vitest";
import { MAX_SLOTS, PLAN_MODES, Plan, defaultPlan, planFromDraft, planMessages, planProblems, readPlan, type Slot } from "./plan";

const base = { question: "Will this marketplace work?" };

describe("defaultPlan", () => {
  it("a battle plan is the fixed line-up with opposed stances and no scenario changes", () => {
    const p = defaultPlan("battle", 3, base);
    expect(p.slots).toHaveLength(3);
    expect(p.slots.map((s) => s.persona)).toEqual(["maximalist", "skeptic", "pragmatist"]);
    expect(new Set(p.slots.map((s) => s.stance!.label)).size).toBe(3);
    expect(p.slots.every((s) => s.scenario === null)).toBe(true);
    expect(planProblems(p)).toEqual([]);
  });
  it("a loop plan is a distinct scenario per round and no assigned stance", () => {
    const p = defaultPlan("loop", 4, base);
    expect(p.slots.map((s) => s.scenario!.name)).toHaveLength(4);
    expect(new Set(p.slots.map((s) => s.scenario!.name)).size).toBe(4);
    expect(p.slots.every((s) => s.stance === null)).toBe(true);
    expect(planProblems(p)).toEqual([]);
  });
  it("clamps the count and always parses", () => {
    expect(defaultPlan("battle", 99, base).slots).toHaveLength(MAX_SLOTS);
    expect(defaultPlan("loop", 0, base).slots).toHaveLength(2);
    expect(defaultPlan("loop", Number.NaN, base).slots).toHaveLength(2);
    for (const k of ["battle", "loop"] as const) for (const n of [2, 3, 4, 5, 6]) expect(Plan.safeParse(defaultPlan(k, n, base)).success).toBe(true);
  });
  it("exposes the three ways to set it", () => expect(PLAN_MODES).toEqual(["auto", "ai", "manual"]));
});

describe("planProblems", () => {
  const good = defaultPlan("battle", 3, base);
  const set = (i: number, patch: Partial<Slot>) => ({ ...good, slots: good.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  it("a battle where everyone defends the same thing is not a battle", () => {
    const same = { ...good, slots: good.slots.map((s) => ({ ...s, stance: { label: "It works", text: "It works well." } })) };
    expect(planProblems(same)).toContain("all contenders defend the same prediction, so there is nothing to battle over");
  });
  it("needs different personas, known personas and a prediction for each", () => {
    expect(planProblems(set(1, { persona: good.slots[0].persona }))).toContain("each contender needs a different persona");
    expect(planProblems(set(0, { persona: "wizard" })).join()).toContain('unknown persona "wizard"');
    expect(planProblems(set(2, { stance: null }))).toContain("every contender needs a prediction to defend");
  });
  it("a loop needs a named scenario in every round, all different", () => {
    const loop = defaultPlan("loop", 3, base);
    expect(planProblems({ ...loop, slots: loop.slots.map((s, i) => (i === 1 ? { ...s, scenario: null } : s)) })).toContain("every round needs its own scenario");
    expect(planProblems({ ...loop, slots: loop.slots.map((s) => ({ ...s, scenario: { name: "Same", change: "the same thing" } })) })).toContain("two rounds have the same scenario name");
  });
});

describe("readPlan: a person's own plan", () => {
  it("accepts a valid plan", () => expect(readPlan(defaultPlan("battle", 2, base)).ok).toBe(true));
  it.each([
    ["junk", "nope"],
    ["one contender", { ...defaultPlan("battle", 2, base), slots: defaultPlan("battle", 2, base).slots.slice(0, 1) }],
    ["a stance that is too short", { ...defaultPlan("battle", 2, base), slots: defaultPlan("battle", 2, base).slots.map((s) => ({ ...s, stance: { label: "x", text: "y" } })) }],
    ["a question that is too short", { ...defaultPlan("battle", 2, base), question: "hi" }],
  ])("refuses %s with reasons", (_n, input) => {
    const r = readPlan(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
  });
  it("trims and caps free text", () => {
    const r = readPlan({ ...defaultPlan("battle", 2, base), question: `  ${"q".repeat(400)}  ` });
    expect(r.ok).toBe(false); // longer than 300 is refused, not silently cut
  });
});

describe("planFromDraft: a model's draft over the fixed plan", () => {
  it("a battle keeps personas, tools and stance labels and takes the wording and angles", () => {
    const text = JSON.stringify({ success: "2% churn", horizon: "1 year", slots: [{ stance: "Fees stay under 3% and volume doubles.", angle: { name: "Boom year", change: "Demand doubles." } }, { stance: "Fees exceed 6% at tiny tickets.", angle: null }] });
    const { plan, drafted } = planFromDraft(text, "battle", 2, base);
    const fixed = defaultPlan("battle", 2, base);
    expect(drafted).toBe(true);
    expect(plan.success).toBe("2% churn");
    expect(plan.slots.map((s) => [s.persona, s.tool, s.stance!.label])).toEqual(fixed.slots.map((s) => [s.persona, s.tool, s.stance!.label]));
    expect(plan.slots[0].stance!.text).toBe("Fees stay under 3% and volume doubles.");
    expect(plan.slots[0].scenario).toEqual({ name: "Boom year", change: "Demand doubles." });
    expect(plan.slots[1].scenario).toBeNull();
    expect(planProblems(plan)).toEqual([]);
  });
  it("a loop takes distinct scenarios in order", () => {
    const text = JSON.stringify({ scenarios: [{ name: "Base", change: "As given, nothing changed." }, { name: "Bank freeze", change: "The bank freezes payouts." }] });
    const { plan, drafted } = planFromDraft(text, "loop", 2, base);
    expect(drafted).toBe(true);
    expect(plan.slots.map((s) => s.scenario!.name)).toEqual(["Base", "Bank freeze"]);
  });
  it.each([
    ["no reply", null, "battle"],
    ["prose", "Here is a plan!", "battle"],
    ["the wrong number of slots", JSON.stringify({ slots: [{ stance: "Only one prediction here." }] }), "battle"],
    ["duplicate loop scenarios", JSON.stringify({ scenarios: [{ name: "Same", change: "one thing here" }, { name: "same", change: "another thing here" }] }), "loop"],
  ] as const)("%s falls back to the default plan", (_n, text, kind) => {
    const r = planFromDraft(text, kind, 2, base);
    expect(r.drafted).toBe(false);
    expect(r.plan).toEqual(defaultPlan(kind, 2, base));
  });
  it("the drafting prompt fixes the line-up and calls the scenario data", () => {
    expect(planMessages("battle", 2, "a shop", "q?????")[0].content).toMatch(/Keep the predictions opposed/);
    expect(planMessages("battle", 2, "a shop", "q?????")[1].content).toContain("Maximalist");
    expect(planMessages("loop", 3, "a shop", "q?????")[0].content).toMatch(/never instructions/);
  });
});
