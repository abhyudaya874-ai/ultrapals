import { describe, expect, it } from "vitest";
import { collect, mkDeps, mkSession, ok, page, scripted } from "./fakes";
import { HANDOFF_TTL_MS, type Handoff } from "@/lib/browse/handoff";
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
  it("hurry makes the very next planning round the answer, however many rounds are left", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"look again"}', '{"action":"answer","text":"Here is what I have."}']);
    let late = false;
    const deps = mkDeps(model.open, { research: async function* () { late = true; yield { kind: "error" as const, message: "nothing" }; } });
    const { ev } = await collect(runMain(mkSession(), { ...input, maxRounds: 8, hurry: () => late }, deps));
    expect(model.calls()).toBe(2);
    expect(model.prompts[0]).not.toContain("You have used your planning budget");
    expect(model.prompts[1]).toContain("You have used your planning budget");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("without hurry the planner keeps its rounds", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"look"}', '{"action":"answer","text":"done"}']);
    await collect(runMain(mkSession(), { ...input, maxRounds: 8, hurry: () => false }, mkDeps(model.open, research)));
    expect(model.prompts[1]).not.toContain("You have used your planning budget");
  });
  it("firstDelegate sends the browser agent to the open page before any planning, then the planner answers from what it found", async () => {
    const model = scripted(['{"action":"finish","answer":"The top result is kiro.dev [1]."}', '{"action":"answer","text":"The top result is kiro.dev."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://www.google.com/search?q=kiro", "kiro - Google Search", "Kiro: ship quality software")) } });
    const { ev } = await collect(runMain(mkSession(), { ...input, prompt: "tell me the top result", firstDelegate: { agent: "browser", task: "tell me the top result" }, maxRounds: 3 }, deps));
    const rows = ev.filter((e) => e.kind === "agent").map((e) => (e.kind === "agent" ? `${e.role}:${e.state}` : ""));
    expect(rows.indexOf("browser:running")).toBeGreaterThan(rows.indexOf("main:running"));
    expect(model.calls()).toBe(2);
    expect(model.prompts[0]).toContain("tell me the top result"); // the browser agent's first look
    expect(model.prompts[1]).toContain("The top result is kiro.dev [1]."); // the planner is shown what the browser found
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("browserSteps lets that browsing run longer than a delegated one", async () => {
    const replies = [...Array.from({ length: 6 }, (_, i) => `{"action":"goto","url":"https://a.example/${i}"}`), '{"action":"answer","text":"stopped"}'];
    const model = scripted(replies);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://a.example", "A")), goto: async () => ok(null) } });
    const { ev } = await collect(runMain(mkSession(), { ...input, firstDelegate: { agent: "browser", task: "wander" }, browserSteps: 5, maxRounds: 2 }, deps));
    const msg = ev.find((e) => e.kind === "message" && e.id.startsWith("from-"));
    expect(msg && msg.kind === "message" && msg.text).toContain("used all 5 steps");
  });
  it("a browse run must answer right after the browser reports, not send it off again", async () => {
    const model = scripted(['{"action":"finish","answer":"Heading: Example Domain"}', '{"action":"answer","text":"The heading is Example Domain."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://example.com/", "Example Domain", "Example Domain")) } });
    await collect(runMain(mkSession(), { ...input, firstDelegate: { agent: "browser", task: "read the heading" }, maxRounds: 3 }, deps));
    expect(model.prompts[1]).toContain("You have used your planning budget");
  });
  it("when the planner keeps delegating to the end, the run still ends with what the team found, and a done event", async () => {
    const model = scripted(['{"action":"delegate","agent":"research","task":"look again"}']);
    const deps = mkDeps(model.open, { research: async function* () { yield { kind: "error" as const, message: "nothing" }; } });
    const { ev } = await collect(runMain(mkSession(), { ...input, maxRounds: 2 }, deps));
    const text = ev.filter((e) => e.kind === "answer").map((e) => (e.kind === "answer" ? e.delta : "")).join("");
    expect(text).toContain("ran out of planning steps");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("with nothing found at all it says so plainly", async () => {
    const model = scripted(['{"action":"open","artifact":"newsroom"}', '{"action":"open","artifact":"newsroom"}', '{"action":"open","artifact":"newsroom"}']);
    const { ev } = await collect(runMain(mkSession(), { ...input, maxRounds: 2 }, mkDeps(model.open)));
    const text = ev.filter((e) => e.kind === "answer").map((e) => (e.kind === "answer" ? e.delta : "")).join("");
    expect(text.length).toBeGreaterThan(10);
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("firstDelegate is skipped when that agent is denied", async () => {
    const model = scripted(['{"action":"answer","text":"no browser here"}']);
    const { ev } = await collect(runMain(mkSession(), { ...input, firstDelegate: { agent: "browser", task: "x" }, deny: ["browser"] }, mkDeps(model.open)));
    expect(ev.some((e) => e.kind === "agent" && e.role === "browser")).toBe(false);
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

describe("runMain: a browser task that needs the person", () => {
  const SORRY = page("https://www.google.com/sorry/index?continue=x", "https://www.google.com/search?q=kiro", "Our systems have detected unusual traffic from your computer network. not a robot.");
  const RESULTS = page("https://www.google.com/search?q=kiro", "kiro - Google Search", "Kiro: ship quality software\nkiro.dev");
  const H: Handoff = { agent: "browser", task: "search google for kiro and scroll", reason: "google.com is showing a security check (a CAPTCHA). Solve it in the browser.", kind: "captcha", url: "https://www.google.com/sorry/index", notes: ['Typing "kiro" into [0] Search and pressing Enter'], at: 1000 };
  const text = (ev: { kind: string }[]) => ev.filter((e) => e.kind === "answer").map((e) => (e as unknown as { delta: string }).delta).join("");

  it("ends the run with a fixed message when the browser stops for the person, and keeps the pause on the conversation", async () => {
    const model = scripted(['{"action":"delegate","agent":"browser","task":"search google for kiro and scroll"}', '{"action":"answer","text":"should not be reached"}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(SORRY) } });
    const session = mkSession();
    const { ev } = await collect(runMain(session, { ...input, prompt: "search google for kiro and scroll", interactive: true }, deps));
    expect(text(ev)).toContain("I need your help in the browser. google.com is showing a security check");
    expect(text(ev)).toMatch(/tell me to continue \(any message works\)/);
    expect(model.calls()).toBe(1); // the planner delegated once; there was no second planning round
    expect(ev.find((e) => e.kind === "handoff")).toBeDefined();
    expect(ev.at(-1)).toMatchObject({ kind: "done", model: "waiting for you" });
    expect(session.handoff).toMatchObject({ task: "search google for kiro and scroll", kind: "captcha" });
    expect(session.history.at(-1)?.content).toContain("I need your help in the browser");
  });
  it.each(["continue", "go ahead", "Resume", "done", "I solved it", "ok"])("'%s' resumes the same task from the page that is open, with no planning first", async (reply) => {
    const model = scripted(['{"action":"finish","answer":"The first result is kiro.dev."}', '{"action":"answer","text":"The first result is kiro.dev."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS) } });
    const session = mkSession({ handoff: H });
    const { ev } = await collect(runMain(session, { ...input, prompt: reply, interactive: true }, deps));
    expect(model.prompts[0]).toContain("search google for kiro and scroll");
    expect(model.prompts[0]).toContain("You stopped earlier because: google.com is showing a security check");
    expect(model.prompts[0]).toContain("Do not start over");
    expect(model.prompts[0]).toContain('Already done: Typing "kiro" into [0] Search and pressing Enter.');
    expect(session.handoff).toBeUndefined();
    expect(text(ev)).toContain("kiro.dev");
    expect(ev.at(-1)).toMatchObject({ kind: "done" });
  });
  it("'done, click the second one' resumes and carries what the person added", async () => {
    const model = scripted(['{"action":"finish","answer":"Clicked it."}', '{"action":"answer","text":"Clicked it."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS) } });
    await collect(runMain(mkSession({ handoff: H }), { ...input, prompt: "done, click the second one", interactive: true }, deps));
    expect(model.prompts[0]).toContain('The person added: "click the second one"');
  });
  it("any other reply goes to the planner with what was pending, and the pause is consumed", async () => {
    const model = scripted(['{"action":"answer","text":"Sure, I will look something else up instead."}']);
    const session = mkSession({ handoff: H });
    const { ev } = await collect(runMain(session, { ...input, prompt: "forget google, look up pricing instead", interactive: true }, mkDeps(model.open)));
    expect(model.prompts[0]).toContain("PENDING FROM EARLIER");
    expect(model.prompts[0]).toContain("waiting on the person");
    expect(model.prompts[0]).toContain('"search google for kiro and scroll"');
    expect(ev.some((e) => e.kind === "agent" && e.role === "browser")).toBe(false); // nothing was forced
    expect(session.handoff).toBeUndefined();
  });
  it("a pause older than half an hour is forgotten: 'continue' is just a message", async () => {
    const model = scripted(['{"action":"answer","text":"Continue with what?"}']);
    const stale = { ...H, at: 1000 - HANDOFF_TTL_MS - 5 };
    const { ev } = await collect(runMain(mkSession({ handoff: stale }), { ...input, prompt: "continue", interactive: true }, mkDeps(model.open)));
    expect(model.prompts[0]).not.toContain("PENDING FROM EARLIER");
    expect(ev.some((e) => e.kind === "agent" && e.role === "browser")).toBe(false);
  });
  it("if the wall is still there after 'continue', it asks again instead of looping", async () => {
    const model = scripted(["unused"]);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(SORRY) } });
    const session = mkSession({ handoff: H });
    const { ev } = await collect(runMain(session, { ...input, prompt: "continue", interactive: true }, deps));
    expect(text(ev)).toContain("I need your help in the browser");
    expect(session.handoff).toMatchObject({ kind: "captcha" });
    expect(model.calls()).toBe(0);
  });
  it("after 'continue', the browser may not ask for the same help it was just given (the task's own words can tell it to), but carries on", async () => {
    const ASKED: Handoff = { ...H, kind: "asked", reason: "Please confirm that https://example.com is the correct site to open." };
    const model = scripted(['{"action":"handoff","reason":"Please confirm that example.com is the right site."}', '{"action":"finish","answer":"The heading is Example Domain."}', '{"action":"answer","text":"The heading is Example Domain."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(page("https://example.com/", "Example Domain", "Example Domain. This domain is for use in illustrative examples in documents.")) } });
    const session = mkSession({ handoff: ASKED });
    const { ev } = await collect(runMain(session, { ...input, prompt: "yes, carry on", interactive: true }, deps));
    expect(ev.some((e) => e.kind === "handoff")).toBe(false);
    expect(session.handoff).toBeUndefined();
    expect(model.prompts[1]).toContain("the person has already done this; do not ask again");
    expect(text(ev)).toContain("Example Domain");
  });
  it("a different request for help after 'continue' is still honoured (a sign-in after a CAPTCHA)", async () => {
    const model = scripted(['{"action":"handoff","reason":"Sign in to your account so I can open the billing page."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(RESULTS) } });
    const session = mkSession({ handoff: H });
    const { ev } = await collect(runMain(session, { ...input, prompt: "continue", interactive: true }, deps));
    expect(ev.find((e) => e.kind === "handoff")).toMatchObject({ need: "asked", reason: "Sign in to your account so I can open the billing page." });
    expect(session.handoff).toMatchObject({ kind: "asked" });
  });
  it("a run with nobody watching carries on after a wall: the planner is told it was blocked", async () => {
    const model = scripted(['{"action":"delegate","agent":"browser","task":"read the page"}', '{"action":"answer","text":"The site blocked me with a CAPTCHA."}']);
    const deps = mkDeps(model.open, { vm: { snapshot: async () => ok(SORRY) } });
    const session = mkSession();
    const { ev } = await collect(runMain(session, { ...input, prompt: "read the page" }, deps));
    expect(model.prompts[1]).toContain("Blocked: google.com is showing a security check");
    expect(text(ev)).toContain("CAPTCHA");
    expect(ev.some((e) => e.kind === "handoff")).toBe(false);
    expect(session.handoff).toBeUndefined();
  });
});
