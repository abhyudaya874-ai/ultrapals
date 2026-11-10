import { describe, expect, it } from "vitest";
import { collect, mkDeps, mkSession, ok, scripted } from "./fakes";
import { MAX_IMAGE_B64, ImageIn, sniffMime } from "./images";
import { runMain } from "./main-agent";
import { AgentBody } from "./request";

const input = { prompt: "what does this show?", attachments: [], path: "/", pageContext: null };
const PNG = `iVBORw0KGgo${"A".repeat(60)}`;
const img = { name: "shot.png", mime: "image/png" as const, data: PNG };

describe("images in the request", () => {
  it.each([
    ["png", PNG, "image/png"],
    ["jpeg", `/9j/${"A".repeat(60)}`, "image/jpeg"],
    ["webp", `UklGR${"A".repeat(60)}`, "image/webp"],
    ["svg", "PHN2ZyB4bWxucz0i", null],
    ["gif", "R0lGODlhAQABAAAA", null],
  ])("sniffs %s", (_n, data, want) => expect(sniffMime(data)).toBe(want));

  it("accepts a real-looking png", () => expect(ImageIn.safeParse(img).success).toBe(true));
  it.each([
    ["a mime that lies about the bytes", { ...img, mime: "image/jpeg" }],
    ["a mime outside the list", { ...img, mime: "image/svg+xml" }],
    ["data that is not base64", { ...img, data: `iVBORw0KGgo${"!".repeat(60)}` }],
    ["a picture over the size cap", { ...img, data: `iVBORw0KGgo${"A".repeat(MAX_IMAGE_B64)}` }],
    ["no name", { ...img, name: "" }],
  ])("refuses %s", (_n, v) => expect(ImageIn.safeParse(v).success).toBe(false));

  it("allows at most three pictures per message", () => {
    expect(AgentBody.safeParse({ message: "hello", images: [img, img, img] }).success).toBe(true);
    expect(AgentBody.safeParse({ message: "hello", images: [img, img, img, img] }).success).toBe(false);
  });
  it("a body without images or a model is still valid (older clients)", () => {
    const r = AgentBody.safeParse({ message: "hello" });
    expect(r.success && r.data.images).toEqual([]);
  });
});

describe("runMain with pictures", () => {
  it("has a vision model read them, shows the step, and gives the planner only the text", async () => {
    const model = scripted(['{"action":"answer","text":"It is a red square."}']);
    const seen: string[] = [];
    const deps = mkDeps(model.open, { vision: (async (images: { name: string }[], instruction: string) => (seen.push(`${images.length}|${instruction.slice(0, 20)}`), ok({ text: "A solid red square.", model: "nemotron-3.5-super-vl" }))) as never });
    const { ev } = await collect(runMain(mkSession(), { ...input, images: [img] }, deps));
    expect(seen).toEqual(["1|Describe what is in "]);
    expect(ev.filter((e) => e.kind === "step")).toMatchObject([{ id: "main-img", state: "running", label: "Reading 1 image" }, { id: "main-img", state: "ok", label: "Read 1 image", detail: "nemotron-3.5-super-vl" }]);
    expect(model.prompts[0]).toContain("shot.png: A solid red square.");
    expect(model.prompts[0]).not.toContain(PNG); // no pixels reach the planner
  });
  it("tells the planner when the picture could not be read, instead of guessing", async () => {
    const model = scripted(['{"action":"answer","text":"I could not read the image."}']);
    const deps = mkDeps(model.open, { vision: (async () => ({ ok: false, degraded: true, reason: "openrouter off" })) as never });
    const { ev } = await collect(runMain(mkSession(), { ...input, images: [img] }, deps));
    expect(ev.find((e) => e.kind === "step" && e.state === "error")).toMatchObject({ detail: "openrouter off" });
    expect(model.prompts[0]).toContain("could not be read: openrouter off");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("does not call the vision model when there are no pictures", async () => {
    const model = scripted(['{"action":"answer","text":"hi"}']);
    let called = 0;
    const deps = mkDeps(model.open, { vision: (async () => (called++, ok({ text: "x", model: "m" }))) as never });
    await collect(runMain(mkSession(), input, deps));
    expect(called).toBe(0);
  });
});

describe("runMain options", () => {
  const research = { research: async function* () { yield { kind: "error" as const, message: "nothing" }; } };
  it.each([[2, 2], [4, 4], [8, 8], [50, 10], [0, 2]])("maxRounds %i plans at most %i times", async (asked, calls) => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"look again"}']);
    await collect(runMain(mkSession(), { ...input, maxRounds: asked }, mkDeps(model.open, research)));
    expect(model.calls()).toBe(calls);
    expect(model.prompts.at(-1)).toContain("You have used your planning budget");
  });
  it("refuses a denied delegate without running it, and tells the planner", async () => {
    const model = scripted(['{"action":"delegate","agent":"promise","task":"pay for the article"}', '{"action":"answer","text":"I could not pay."}']);
    let ran = 0;
    const deps = mkDeps(model.open, { promise: { create: (async () => (ran++, ok({}))) as never } });
    const { ev } = await collect(runMain(mkSession(), { ...input, deny: ["promise"] }, deps));
    expect(ran).toBe(0);
    expect(ev.some((e) => e.kind === "agent" && e.id.startsWith("promise"))).toBe(false);
    expect(model.prompts[1]).toContain("promise is not available in this run");
  });
});
