import { describe, expect, it } from "vitest";
import { addSlot, canAdd, canRemove, problemsOf, removeSlot, updateSlot } from "./plan-edit";
import { MAX_SLOTS, MIN_SLOTS, defaultPlan, planProblems } from "./plan";

const base = { question: "Will fees stay near 12 percent?" };

describe("addSlot / removeSlot", () => {
  it("adds a battle team that keeps the plan valid, up to the limit", () => {
    let p = defaultPlan("battle", MIN_SLOTS, base);
    while (canAdd(p)) {
      p = addSlot(p);
      expect(planProblems(p)).toEqual([]);
    }
    expect(p.slots).toHaveLength(MAX_SLOTS);
    expect(addSlot(p)).toBe(p);
  });
  it("adds a loop round with a scenario not used yet", () => {
    let p = defaultPlan("loop", MIN_SLOTS, base);
    while (canAdd(p)) {
      p = addSlot(p);
      expect(planProblems(p)).toEqual([]);
    }
    expect(new Set(p.slots.map((s) => s.scenario!.name)).size).toBe(MAX_SLOTS);
  });
  it("never removes below the minimum", () => {
    let p = defaultPlan("battle", 3, base);
    p = removeSlot(p, 0);
    expect(p.slots).toHaveLength(2);
    expect(canRemove(p)).toBe(false);
    expect(removeSlot(p, 0)).toBe(p);
  });
  it("removes the one asked for", () => {
    const p = defaultPlan("battle", 4, base);
    expect(removeSlot(p, 1).slots.map((s) => s.persona)).toEqual([p.slots[0].persona, p.slots[2].persona, p.slots[3].persona]);
  });
});

describe("updateSlot", () => {
  it("changes only that slot", () => {
    const p = defaultPlan("loop", 3, base);
    const q = updateSlot(p, 1, { scenario: { name: "Mine", change: "my own change" } });
    expect(q.slots[1].scenario?.name).toBe("Mine");
    expect(q.slots[0]).toBe(p.slots[0]);
    expect(q.slots[2]).toBe(p.slots[2]);
  });
});

describe("problemsOf", () => {
  it("is empty for a good plan", () => {
    expect(problemsOf(defaultPlan("battle", 4, base))).toEqual([]);
    expect(problemsOf(defaultPlan("loop", 5, base))).toEqual([]);
  });
  it("says where a field is too short, in the editor's words", () => {
    const p = updateSlot(defaultPlan("battle", 3, base), 1, { stance: { label: "It fails", text: "no" } });
    expect(problemsOf(p)).toEqual(["Team 2: the prediction needs a little more text"]);
  });
  it("says which round has no scenario and which are duplicated", () => {
    const p = defaultPlan("loop", 3, base);
    expect(problemsOf(updateSlot(p, 0, { scenario: null }))).toContain("Every round needs its own scenario");
    expect(problemsOf(updateSlot(p, 1, { scenario: { ...p.slots[0].scenario! } }))).toContain("Two rounds have the same scenario name");
  });
  it("says when two teams argue the same thing", () => {
    const p = defaultPlan("battle", 2, base);
    const same = updateSlot(p, 1, { stance: p.slots[0].stance });
    expect(problemsOf(same)).toContain("All contenders defend the same prediction, so there is nothing to battle over");
  });
  it("a question that is too long is reported", () => {
    expect(problemsOf({ ...defaultPlan("battle", 2, base), question: "x".repeat(301) })).toEqual(["The question is too long"]);
  });
});
