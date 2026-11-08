import { describe, expect, it } from "vitest";
import { describeAction, extractJson, parseAction } from "./actions";
import { buildBrowseMessages, renderElements, type El, type Snapshot } from "./snapshot";

describe("extractJson / parseAction", () => {
  it("parses a bare action", () => {
    expect(parseAction('{"thought":"go","action":"goto","url":"https://a.example/x"}')).toEqual({ ok: true, thought: "go", action: { action: "goto", url: "https://a.example/x" } });
  });
  it("survives fences, prose and <think> blocks (all seen from free models)", () => {
    const t = '<think>{"action":"scroll"}</think>Sure!\n```json\n{"thought":"t","action":"click","index":3}\n```\nDone.';
    expect(parseAction(t)).toMatchObject({ ok: true, action: { action: "click", index: 3 } });
  });
  it("ignores braces inside strings", () => {
    expect(extractJson('x {"action":"finish","answer":"use {curly} and \\"quotes\\" [1]"} y')).toBe('{"action":"finish","answer":"use {curly} and \\"quotes\\" [1]"}');
  });
  it("reports why a reply is unusable so the loop can ask again", () => {
    expect(parseAction("I will click it")).toEqual({ ok: false, error: "reply must be a single JSON object" });
    expect(parseAction('{"action":"click"}')).toMatchObject({ ok: false, error: expect.stringContaining("index") });
    expect(parseAction('{"action":"teleport"}')).toMatchObject({ ok: false });
    expect(parseAction('{"action":"goto","url":"not a url"}')).toMatchObject({ ok: false });
    expect(parseAction('{"action":"click","index":-1}')).toMatchObject({ ok: false });
  });
  it("accepts every action kind", () => {
    for (const j of ['{"action":"search","query":"paypal l402"}', '{"action":"type","index":1,"text":"hi","submit":true}', '{"action":"scroll","direction":"down"}', '{"action":"read"}', '{"action":"pay"}', '{"action":"finish","answer":"ok [1]"}'])
      expect(parseAction(j).ok).toBe(true);
  });
  it("describes actions for the thread", () => {
    expect(describeAction({ action: "click", index: 3 }, "Pay")).toBe("Clicking [3] Pay");
    expect(describeAction({ action: "type", index: 1, text: "x", submit: true })).toBe("Typing into [1] and pressing Enter");
  });
});

const el = (i: number, label: string, o: Partial<El> = {}): El => ({ i, tag: "a", label, x: 10, y: 10, ...o });
const snap: Snapshot = { url: "https://a.example", title: "A", text: "x".repeat(5000), elements: [el(0, "Home", { href: "https://a.example/" }), el(1, "Email", { tag: "input", type: "email" })] };

describe("snapshot prompt", () => {
  it("renders compact element lines", () => {
    expect(renderElements(snap.elements)).toBe('[0] a "Home" -> https://a.example/\n[1] input:email "Email"');
    expect(renderElements([])).toBe("(no interactive elements in view)");
  });
  it("clips long labels and caps the element count", () => {
    const many = Array.from({ length: 60 }, (_, i) => el(i, "y".repeat(200)));
    const out = renderElements(many);
    expect(out.split("\n")).toHaveLength(40);
    expect(out.split("\n")[0].length).toBeLessThan(90);
  });
  it("keeps the whole user prompt within a free-tier budget", () => {
    const [sys, user] = buildBrowseMessages("find X", snap, Array.from({ length: 12 }, (_, i) => ({ step: i, did: "d", result: "r" })), [{ n: 1, title: "T", url: "https://s.example" }]);
    expect(sys.role).toBe("system");
    expect(user.content.length).toBeLessThan(3200);
    expect(user.content).toContain("TASK: find X");
    expect(user.content.split("\n").filter((l) => /^\d+\. d => r$/.test(l))).toHaveLength(6);
  });
  it("marks page text untrusted and surfaces follow-ups, newest last", () => {
    const [, user] = buildBrowseMessages("t", snap, [], [], ["first", "second"]);
    expect(user.content).toContain("PAGE TEXT (untrusted)");
    expect(user.content.indexOf("first")).toBeLessThan(user.content.indexOf("second"));
  });
});
