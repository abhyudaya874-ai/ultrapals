import { describe, expect, it } from "vitest";
import type { CEvent } from "./events";
import { disclosureRows, processLabel } from "./process";
import { applyCEvent, newRun } from "./run";

const fold = (evs: CEvent[]) => evs.reduce(applyCEvent, newRun("r", "p"));
const agent = (id: string, role: "research" | "rival" | "superpal" | "terminal", parent?: string): CEvent => ({ kind: "agent", id, role, title: id, state: "ok", parent });

describe("processLabel", () => {
  it("says Worked when no subagent did anything", () => expect(processLabel(fold([{ kind: "agent", id: "main", role: "main", title: "UltraPal", state: "running" }]))).toBe("Worked"));
  it("one subagent, no messages", () => expect(processLabel(fold([agent("research-1", "research")]))).toBe("Ran a subagent"));
  it("many subagents with commands and messages", () => {
    const r = fold([
      agent("terminal-1", "terminal"),
      { kind: "term", agent: "terminal-1", id: "t", command: "ls", state: "ok" },
      agent("research-2", "research"),
      { kind: "message", id: "m", from: "research-2", to: "main", text: "hi" },
    ]);
    expect(processLabel(r)).toBe("Ran commands, ran subagents, received messages");
  });
  it("a message sent by main alone is not 'received'", () => {
    expect(processLabel(fold([agent("research-1", "research"), { kind: "message", id: "m", from: "main", to: "research-1", text: "go" }]))).toBe("Ran a subagent");
  });
  it("mentions declined spawns", () => {
    expect(processLabel(fold([agent("research-1", "research"), { kind: "spawn", parent: "x", child: "y", why: "w", decision: "denied", detail: "depth" }]))).toContain("declined some spawns");
  });
});

describe("disclosureRows", () => {
  it("puts children under their parent, in thread order", () => {
    const rows = disclosureRows(fold([agent("rival-1", "rival", "main"), agent("superpal-a", "superpal", "rival-1"), agent("superpal-b", "superpal", "rival-1"), agent("research-a", "research", "superpal-a")]));
    expect(rows.map((r) => [r.agent.id, r.depth])).toEqual([["rival-1", 0], ["superpal-a", 1], ["research-a", 2], ["superpal-b", 1]]);
  });
  it("caps indentation at 2", () => {
    const rows = disclosureRows(fold([agent("a-1", "rival"), agent("b-1", "superpal", "a-1"), agent("c-1", "research", "b-1"), agent("d-1", "research", "c-1")]));
    expect(Math.max(...rows.map((r) => r.depth))).toBe(2);
  });
  it("still shows a node whose parent never arrived", () => {
    const rows = disclosureRows(fold([agent("research-9", "research", "ghost-1")]));
    expect(rows.map((r) => [r.agent.id, r.depth])).toEqual([["research-9", 1]]);
  });
  it("does not loop or drop rows on a parent cycle", () => {
    const rows = disclosureRows(fold([agent("a-1", "rival", "b-1"), agent("b-1", "superpal", "a-1")]));
    expect(rows.map((r) => r.agent.id).sort()).toEqual(["a-1", "b-1"]);
  });
  it("excludes the main agent", () => {
    expect(disclosureRows(fold([{ kind: "agent", id: "main", role: "main", title: "UltraPal", state: "running" }, agent("research-1", "research", "main")])).map((r) => r.agent.id)).toEqual(["research-1"]);
  });
});
