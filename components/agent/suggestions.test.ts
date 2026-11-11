import { describe, expect, it } from "vitest";
import { asksForSchedule } from "@/lib/automations/core";
import { MODE_KINDS } from "@/lib/arena/mode";
import { defaultPlan, planProblems } from "@/lib/arena/plan";
import { AgentBody } from "@/lib/computer/request";
import { SUGGESTIONS_BY_MODE, SUGGESTION_CAPTION, startsAtOnce, suggestionsFor } from "./suggestions";

describe("suggestions for every mode", () => {
  it("each mode has some, and a Battle and a Loop have at least five", () => {
    for (const k of MODE_KINDS) expect(suggestionsFor(k).length).toBeGreaterThanOrEqual(5);
  });
  it.each(MODE_KINDS)("%s: each is a real message the server would accept, and none repeats", (k) => {
    const texts = suggestionsFor(k).map((s) => s.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) {
      expect(t.length).toBeGreaterThanOrEqual(30);
      expect(AgentBody.safeParse({ message: t }).success, t).toBe(true);
    }
  });
  it("no suggestion is offered in two modes: each mode shows what only it does well", () => {
    const all = MODE_KINDS.flatMap((k) => suggestionsFor(k).map((s) => s.text));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("chat suggestions", () => {
  it("the ones that schedule something really ask for it, so UltraPal is allowed to create the automation", () => {
    const auto = SUGGESTIONS_BY_MODE.chat.filter((s) => s.automation);
    expect(auto.length).toBeGreaterThanOrEqual(2);
    for (const s of auto) expect(asksForSchedule(s.text), s.text).toBe(true);
  });
  it("the others do not ask for anything to repeat", () => {
    for (const s of SUGGESTIONS_BY_MODE.chat.filter((x) => !x.automation)) expect(asksForSchedule(s.text), s.text).toBe(false);
  });
});

describe("battle suggestions", () => {
  it("are questions or predictions teams can disagree about, not tasks", () => {
    for (const s of SUGGESTIONS_BY_MODE.battle) expect(s.text, s.text).toMatch(/\?/);
  });
  it("each makes a plan the Battle accepts, for every team count", () => {
    for (const s of SUGGESTIONS_BY_MODE.battle) for (const n of [2, 3, 4, 6]) expect(planProblems(defaultPlan("battle", n, { question: s.text.slice(0, 300) })), `${n}: ${s.text}`).toEqual([]);
  });
  it("none is automation-flavoured (a Battle is run by hand here)", () => {
    for (const s of SUGGESTIONS_BY_MODE.battle) expect(s.automation).toBeUndefined();
  });
});

describe("loop suggestions", () => {
  it("each names how it will be pushed round after round, which is what a Loop is for", () => {
    for (const s of SUGGESTIONS_BY_MODE.loop) expect(s.text, s.text).toMatch(/\b(each round|every round|one in each round|round)\b/i);
  });
  it("each makes a plan the Loop accepts, for every round count", () => {
    for (const s of SUGGESTIONS_BY_MODE.loop) for (const n of [2, 3, 5, 6]) expect(planProblems(defaultPlan("loop", n, { question: s.text.slice(0, 300) })), `${n}: ${s.text}`).toEqual([]);
  });
});

describe("what a click does", () => {
  it("a chat starts at once; a Battle or Loop only fills the box, because it opens several cloud computers", () => {
    expect(startsAtOnce("chat")).toBe(true);
    expect(startsAtOnce("battle")).toBe(false);
    expect(startsAtOnce("loop")).toBe(false);
  });
  it("the captions tell a person what makes a good Battle or Loop; a chat needs none", () => {
    expect(SUGGESTION_CAPTION.chat).toBe("");
    expect(SUGGESTION_CAPTION.battle.length).toBeGreaterThan(20);
    expect(SUGGESTION_CAPTION.loop.length).toBeGreaterThan(20);
  });
});
