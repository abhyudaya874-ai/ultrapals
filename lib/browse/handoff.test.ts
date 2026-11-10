import { describe, expect, it } from "vitest";
import { HANDOFF_TTL_MS, freshHandoff, handoffMessage, needsHuman, noticeFor, parseResume, pendingNote, resumeTask, sameAsk, type Handoff } from "./handoff";

const page = (url: string, title: string, text: string, elements: { type?: string }[] = []) => ({ url, title, text, elements: elements.map((e, i) => ({ i, tag: "input", label: "", x: 0, y: 0, ...e })) });

describe("needsHuman: walls that stop a program", () => {
  it("Google's 'unusual traffic' page, as seen live", () => {
    const n = needsHuman(page("https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dkiro", "https://www.google.com/search?q=kiro", "About this page\nOur systems have detected unusual traffic from your computer network. This page checks to see if it's really you sending the requests, and not a robot."));
    expect(n).toMatchObject({ kind: "captcha", stop: true });
    expect(n?.reason).toContain("google.com");
    expect(n?.reason).toContain("Solve it in the browser");
  });
  it("a Cloudflare challenge", () => {
    expect(needsHuman(page("https://example.org/", "Just a moment...", "example.org\nVerify you are human by completing the action below.\nChecking if the site connection is secure"))).toMatchObject({ kind: "captcha", stop: true });
  });
  it("a challenge recognised by its address alone", () => {
    expect(needsHuman(page("https://site.example/captcha?next=/cart", "Site", "Welcome"))).toMatchObject({ kind: "captcha" });
    expect(needsHuman(page("https://www.google.com/recaptcha/api2/anchor", "reCAPTCHA", ""))).toMatchObject({ kind: "captcha" });
  });
  it.each(["Press & hold to confirm you are a human", "I'm not a robot", "Please solve this CAPTCHA to continue", "Are you a robot?"])("recognises %j on a short page", (t) => {
    expect(needsHuman(page("https://x.example/a", "Check", t))?.kind).toBe("captcha");
  });
  it("does NOT stop on a long article that talks about CAPTCHAs", () => {
    const article = `A CAPTCHA is a test to verify you are human. ${"Some history of the Turing test and bots. ".repeat(120)}`;
    expect(needsHuman(page("https://en.wikipedia.org/wiki/CAPTCHA", "CAPTCHA - Wikipedia", article))).toBeNull();
  });
  it("does NOT stop on an ordinary page", () => {
    expect(needsHuman(page("https://www.google.com/search?q=kiro", "kiro - Google Search", "Kiro: ship quality software\nkiro.dev"))).toBeNull();
    expect(needsHuman(page("https://example.com/", "Example Domain", "This domain is for use in illustrative examples."))).toBeNull();
  });
  it("a title like 'Access denied' on a short page is a wall; the same words in a long page are not", () => {
    expect(needsHuman(page("https://shop.example/", "Access denied", "You do not have permission"))?.kind).toBe("captcha");
    expect(needsHuman(page("https://blog.example/post", "Access denied", "x".repeat(3000)))).toBeNull();
  });
});

describe("needsHuman: hints, not stops", () => {
  it("a visible password field is a sign-in hint", () => {
    const n = needsHuman(page("https://github.com/login", "Sign in to GitHub", "Username or email address\nPassword", [{ type: "text" }, { type: "password" }]));
    expect(n).toMatchObject({ kind: "login", stop: false });
    expect(n?.reason).toBe("github.com is asking you to sign in.");
  });
  it.each(["Enter the 6-digit code we sent to your phone", "Two-factor authentication is on", "We sent you a verification code", "Verify your identity to continue"])("%j is a verification hint", (t) => {
    expect(needsHuman(page("https://bank.example/verify", "Verify", t))).toMatchObject({ kind: "verification", stop: false });
  });
  it("a CAPTCHA wins over a sign-in form on the same page", () => {
    expect(needsHuman(page("https://x.example/", "Just a moment...", "Verify you are human", [{ type: "password" }]))?.kind).toBe("captcha");
  });
  it("the planner is told what to do about a hint, and told nothing for a stop or no need", () => {
    expect(noticeFor(needsHuman(page("https://github.com/login", "Sign in", "Password", [{ type: "password" }])))).toMatch(/must never type any[\s\S]*handoff/);
    expect(noticeFor(null)).toBe("");
    expect(noticeFor({ kind: "captcha", stop: true, reason: "x" })).toBe("");
  });
});

describe("parseResume: the person says to carry on, in any of the usual ways", () => {
  it.each(["continue", "Continue", "go ahead", "Go on", "resume", "done", "Done!", "ok", "okay", "yes", "proceed", "carry on", "keep going", "I solved it", "I'm done", "i am back", "it's done", "all set", "ready", "thanks", "thank you", "I did it", "try again", "I logged in", "solved"])("%s", (m) => {
    expect(parseResume(m)).toEqual({ resume: true, extra: "" });
  });
  it("keeps what they added after it", () => {
    expect(parseResume("done, now click the first result")).toEqual({ resume: true, extra: "now click the first result" });
    expect(parseResume("Okay - scroll down and read the second one.")).toEqual({ resume: true, extra: "scroll down and read the second one." });
  });
  it.each(["search for something else", "what happened?", "cancel that", "actually look up pricing instead", "no", "stop", "doneness of steak"])("%j is not a resume", (m) => {
    expect(parseResume(m).resume).toBe(false);
  });
  it("a long message is never a bare resume", () => expect(parseResume(`done ${"x ".repeat(200)}`).resume).toBe(false));
});

const H: Handoff = { agent: "browser", task: "search google for kiro and scroll", reason: "google.com is showing a security check (a CAPTCHA). Solve it in the browser.", kind: "captcha", url: "https://www.google.com/sorry/index", notes: ['Typing "kiro" into [7] Search and pressing Enter'], at: 1_000 };

describe("sameAsk: has the person already been asked this?", () => {
  it.each([
    ["Please confirm that https://example.com is the correct site to open.", "Please confirm that example.com is the right site."],
    ["Solve the CAPTCHA in the browser.", "Please solve the captcha in the browser window."],
    ["Sign in to GitHub so I can open your repository.", "Sign in to GitHub so I can open your repository"],
  ])("%j and %j are the same request", (a, b) => expect(sameAsk(a, b)).toBe(true));
  it.each([
    ["google.com is showing a security check (a CAPTCHA). Solve it in the browser.", "Sign in to your account so I can open the billing page."],
    ["Enter the six digit code from your phone.", "Pick which of the two plans you want."],
  ])("%j and %j are different requests", (a, b) => expect(sameAsk(a, b)).toBe(false));
  it("handles text with no real words", () => {
    expect(sameAsk("ok", "OK")).toBe(true);
    expect(sameAsk("ok", "no")).toBe(false);
  });
});

describe("freshHandoff", () => {
  it("is kept for half an hour", () => {
    expect(freshHandoff(H, 1_000 + HANDOFF_TTL_MS)).toBe(H);
    expect(freshHandoff(H, 1_001 + HANDOFF_TTL_MS)).toBeNull();
    expect(freshHandoff(undefined, 5)).toBeNull();
  });
});

describe("what is written when a pause starts and ends", () => {
  it("the continuation keeps the task, the reason, the progress and anything the person added", () => {
    const t = resumeTask(H, "pick the second result");
    expect(t).toContain("THE ORIGINAL TASK, for what you are trying to achieve. Its first steps are done: carry on with what is left of it, not from its beginning: search google for kiro and scroll");
    expect(t).toContain("You stopped earlier because: google.com is showing a security check");
    expect(t).toContain("Look at the page that is open NOW");
    expect(t).toContain("Do not start over");
    expect(t).toContain("Do not ask for that help again");
    expect(t.indexOf("CONTINUING AFTER A PAUSE")).toBeLessThan(t.indexOf("THE ORIGINAL TASK")); // the instruction to continue comes before the old instructions
    expect(t).toContain('Already done: Typing "kiro" into [7] Search and pressing Enter.');
    expect(t).toContain('The person added: "pick the second result"');
    expect(resumeTask({ ...H, notes: [] }, "")).not.toMatch(/Already done|The person added/);
  });
  it("the message to the person says what to do and that any reply continues", () => {
    const m = handoffMessage(H);
    expect(m).toContain("I need your help in the browser. google.com is showing a security check");
    expect(m).toContain("So far: Typing");
    expect(m).toMatch(/tell me to continue \(any message works\)/);
    expect(handoffMessage({ ...H, notes: [] })).not.toContain("So far");
  });
  it("the planner is told what was pending when the reply is not a plain 'continue'", () => {
    const n = pendingNote(H);
    expect(n).toContain("waiting on the person");
    expect(n).toContain('"search google for kiro and scroll"');
    expect(n).toContain("https://www.google.com/sorry/index");
    expect(n).toMatch(/delegate the same task to the browser again/);
  });
});
