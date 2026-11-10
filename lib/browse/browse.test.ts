import { describe, expect, it } from "vitest";
import { describeAction, extractJson, parseAction } from "./actions";
import { BROWSE_SYSTEM, buildBrowseMessages, changeNote, memoryText, renderElements, scrollLine, textChange, type El, type Snapshot } from "./snapshot";

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
    expect(describeAction({ action: "type", index: 1, text: "x", submit: true })).toBe('Typing "x" into [1] and pressing Enter');
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

describe("the browser actions an agent can use", () => {
  const ok = (j: unknown) => parseAction(JSON.stringify(j));
  it.each([
    [{ action: "key", key: "Enter" }],
    [{ action: "key", key: "PageDown" }],
    [{ action: "back" }],
    [{ action: "forward" }],
    [{ action: "reload" }],
    [{ action: "wait", seconds: 3 }],
    [{ action: "find", text: "pricing" }],
    [{ action: "select", index: 4, option: "Monthly" }],
    [{ action: "scroll", to: "bottom" }],
  ])("accepts %j", (j) => expect(ok(j).ok).toBe(true));
  it("fills in the defaults: scroll goes down, wait is 2 seconds", () => {
    expect(ok({ action: "scroll" })).toMatchObject({ ok: true, action: { action: "scroll", direction: "down" } });
    expect(ok({ action: "wait" })).toMatchObject({ ok: true, action: { action: "wait", seconds: 2 } });
  });
  it.each([
    [{ action: "key", key: "Control+w" }],
    [{ action: "key", key: "F5" }],
    [{ action: "key", key: "Alt+F4" }],
    [{ action: "wait", seconds: 60 }],
    [{ action: "find", text: "" }],
    [{ action: "select", index: 1 }],
    [{ action: "scroll", to: "middle" }],
  ])("refuses %j", (j) => expect(ok(j).ok).toBe(false));
  it("describes the new actions", () => {
    expect(describeAction({ action: "key", key: "PageDown" })).toBe("Pressing PageDown");
    expect(describeAction({ action: "back" })).toBe("Going back");
    expect(describeAction({ action: "wait", seconds: 1 })).toBe("Waiting 1 second");
    expect(describeAction({ action: "find", text: "pricing" })).toBe('Looking for "pricing" on the page');
    expect(describeAction({ action: "scroll", direction: "down", to: "top" })).toBe("Scrolling to the top");
    expect(describeAction({ action: "select", index: 2, option: "Annual" }, "Plan")).toBe('Choosing "Annual" in [2] Plan');
  });
  it("never writes what is typed into a password field", () => {
    expect(describeAction({ action: "type", index: 3, text: "hunter2", submit: true }, "password")).toBe("Typing into [3] password and pressing Enter");
    expect(describeAction({ action: "type", index: 3, text: "hunter2" }, "Password")).not.toContain("hunter2");
  });
  it("shortens a long typed text", () => expect(describeAction({ action: "type", index: 1, text: "x".repeat(80) })).toContain("…"));
});

const mk = (o: Partial<Snapshot> = {}): Snapshot => ({ url: "https://a.example/", title: "A", text: "one\ntwo\nthree", elements: [], ...o });

describe("scrollLine", () => {
  it("says how far down the page the view is", () => {
    expect(scrollLine({ y: 0, height: 2700, view: 800 })).toBe("scrolled 0 of 2700 px; 1900 px more below");
    expect(scrollLine({ y: 1900, height: 2700, view: 800 })).toBe("scrolled 1900 of 2700 px; you are at the bottom");
  });
  it("a page that fits on the screen cannot be scrolled", () => expect(scrollLine({ y: 0, height: 800, view: 800 })).toBe("the whole page fits on the screen"));
  it("says nothing when the page did not report it", () => {
    expect(scrollLine(undefined)).toBe("");
    expect(scrollLine({ y: 0, height: 0, view: 0 })).toBe("");
  });
});

describe("textChange", () => {
  it("0 for the same text, 1 for none in common, in between for a partial change", () => {
    expect(textChange("a\nb", "a\nb")).toBe(0);
    expect(textChange("a\nb", "c\nd")).toBe(1);
    expect(textChange("a\nb\nc\nd", "a\nb\nc\ne")).toBeCloseTo(0.25, 5);
    expect(textChange("", "")).toBe(0);
  });
});

describe("changeNote: what the last action did", () => {
  it("is empty for the first look", () => expect(changeNote(null, mk())).toBe(""));
  it("names a new page", () => expect(changeNote(mk(), mk({ url: "https://b.example/x", title: "B" }))).toBe('the browser is now on https://b.example/x ("B")'));
  it("names a scroll", () => expect(changeNote(mk({ scroll: { y: 0, height: 3000, view: 800 } }), mk({ scroll: { y: 600, height: 3000, view: 800 } }))).toBe("scrolled from 0 to 600 px"));
  it("names new text on the same page", () => expect(changeNote(mk(), mk({ text: "x\ny\nz" }))).toBe("the page text changed"));
  it("says when nothing changed", () => expect(changeNote(mk(), mk())).toBe("nothing visible changed"));
});

describe("notes the model writes down", () => {
  it("are read from the reply, flattened and capped, and absent when it wrote none", () => {
    expect(parseAction('{"thought":"t","note":"Plan A  costs\\n$20 on stripe.com","action":"scroll"}')).toMatchObject({ ok: true, note: "Plan A costs $20 on stripe.com" });
    expect(parseAction(`{"note":"${"x".repeat(900)}","action":"scroll"}`)).toMatchObject({ ok: true, note: "x".repeat(300) });
    expect(parseAction('{"action":"scroll"}')).not.toHaveProperty("note");
    expect(parseAction('{"note":"   ","action":"scroll"}')).not.toHaveProperty("note");
    expect(parseAction('{"note":42,"action":"scroll"}')).not.toHaveProperty("note");
  });
  it("keep the newest, dropping whole old notes first", () => {
    expect(memoryText(["a".repeat(10), "b".repeat(10), "c".repeat(10)], 25)).toBe(`${"b".repeat(10)}\n${"c".repeat(10)}`);
    expect(memoryText([], 25)).toBe("");
    expect(memoryText(["z".repeat(100)], 25)).toBe("z".repeat(25)); // one note longer than the limit is cut, not dropped
  });
  it("come back in the prompt as the model's own words, and only when there are some", () => {
    expect(buildBrowseMessages("t", mk(), [], [], [], "", "Plan A $20 (stripe.com)")[1].content).toContain("YOUR NOTES (written by you on earlier pages):\nPlan A $20 (stripe.com)");
    expect(buildBrowseMessages("t", mk(), [], [])[1].content).not.toContain("YOUR NOTES");
  });
  it("the model is told how to use them, and to open a link itself when a click does nothing", () => {
    expect(BROWSE_SYSTEM).toContain('"note"');
    expect(BROWSE_SYSTEM).toContain("YOUR NOTES stay");
    expect(BROWSE_SYSTEM).toContain("open the link yourself with goto");
  });
});

describe("what the model is told", () => {
  it("knows how to search ON a site, that links open in place, and never to type a password", () => {
    expect(BROWSE_SYSTEM).toContain("use that site's own search box");
    expect(BROWSE_SYSTEM).toContain("Start from the page that is already open");
    expect(BROWSE_SYSTEM).toMatch(/never type a password/);
  });
  it("shows the scroll position on the PAGE line", () => {
    const m = buildBrowseMessages("t", mk({ scroll: { y: 600, height: 2400, view: 800 } }), [], []);
    expect(m[1].content).toContain("scrolled 600 of 2400 px; 1000 px more below");
  });
  it("shows the last six steps with what they changed", () => {
    const notes = Array.from({ length: 9 }, (_, i) => ({ step: i + 1, did: `d${i + 1}`, result: `r${i + 1}` }));
    const c = buildBrowseMessages("t", mk(), notes, [])[1].content;
    expect(c).toContain("4. d4 => r4");
    expect(c).not.toContain("3. d3 => r3");
  });
});
