import { describe, expect, it } from "vitest";
import { collect, mkDeps, mkSession, scripted } from "./fakes";
import { runMain } from "./main-agent";
import { parseMainAction } from "./main-actions";

const act = '{"action":"automate","name":"Rails watch","task":"Compare the rails and save a CSV","schedule":"every 6 hours"}';
const input = (prompt: string, extra = {}) => ({ prompt, attachments: [], path: "/", pageContext: null, ...extra });

describe("the automate action", () => {
  it("parses", () => expect(parseMainAction(act)).toMatchObject({ ok: true, action: { action: "automate", schedule: "every 6 hours" } }));
  it("creates the automation when the user asked for a schedule, with their time zone, and says how often it runs", async () => {
    const seen: unknown[] = [];
    const model = scripted([act, '{"action":"answer","text":"Done."}']);
    const deps = mkDeps(model.open, { automations: { create: (async (spec: unknown) => (seen.push(spec), { ok: true, id: "a1" })) as never } });
    const { ev } = await collect(runMain(mkSession(), input("compare the payment rails every 6 hours", { tzOffsetMin: 330 }), deps));
    expect(seen).toEqual([expect.objectContaining({ name: "Rails watch", prompt: "Compare the rails and save a CSV", schedule: { kind: "every", minutes: 360 }, tzOffsetMin: 330 })]);
    expect(ev.find((e) => e.kind === "step" && e.state === "ok" && e.label.startsWith("Created"))).toMatchObject({ detail: "Every 6 hours" });
    expect(model.prompts[1]).toContain('Created the automation "Rails watch" (Every 6 hours)');
  });
  it("does nothing when the user did not ask for anything to repeat (a page cannot talk the model into it)", async () => {
    let made = 0;
    const model = scripted([act, '{"action":"answer","text":"No."}']);
    const deps = mkDeps(model.open, { automations: { create: (async () => (made++, { ok: true, id: "x" })) as never } });
    await collect(runMain(mkSession(), input("summarise this page"), deps));
    expect(made).toBe(0);
    expect(model.prompts[1]).toContain("does not ask for anything to repeat");
  });
  it.each([["every 5 minutes"], ["whenever you like"], ["daily 25:00"]])("a schedule it cannot read exactly (%s) is sent back with the accepted forms", async (schedule) => {
    let made = 0;
    const model = scripted([`{"action":"automate","name":"n","task":"do the thing","schedule":"${schedule}"}`, '{"action":"answer","text":"ok"}']);
    const deps = mkDeps(model.open, { automations: { create: (async () => (made++, { ok: true, id: "x" })) as never } });
    await collect(runMain(mkSession(), input("do the thing every day"), deps));
    expect(made).toBe(0);
    expect(model.prompts[1]).toContain("could not be read");
  });
  it("passes the store's refusal (too many automations) to the planner", async () => {
    const model = scripted([act, '{"action":"answer","text":"You have too many."}']);
    const deps = mkDeps(model.open, { automations: { create: (async () => ({ ok: false, reason: "at most 8 automations; delete one first" })) as never } });
    const { ev } = await collect(runMain(mkSession(), input("run this every 6 hours"), deps));
    expect(model.prompts[1]).toContain("at most 8 automations");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
});
