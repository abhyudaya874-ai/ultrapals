import { describe, expect, it } from "vitest";
import { doingLine, ringHeadline, ringSource, toolLine } from "./describe";
import type { Ring } from "./rings";

const ring = (o: Partial<Ring> = {}): Ring => ({ key: "chat", label: "UltraPal", model: "openai/gpt-oss-120b", provider: "groq", used: 6100, window: 393_216, prompt: 5000, completion: 1100, draft: 0, exact: true, calls: 3, tokens: 8100, started: true, agents: [], worst: 5, working: 0, live: false, ...o });
const load = (id: string) => ({ id }) as Ring["agents"][number];

describe("ringHeadline", () => {
  it("states the percent, the tokens and the window, and how many agents it adds up", () => {
    expect(ringHeadline(ring({ agents: [load("main"), load("browser-1")] }))).toBe("2% (6.1K / 393K) context used across 2 agents");
  });
  it("says nothing about agents for a single one, and says 'about' for an estimate or before any call", () => {
    expect(ringHeadline(ring({ agents: [load("main")] }))).toBe("2% (6.1K / 393K) context used");
    expect(ringHeadline(ring({ exact: false }))).toMatch(/^about /);
    expect(ringHeadline(ring({ started: false }))).toMatch(/^about /);
  });
});

describe("ringSource", () => {
  it("separates what the providers counted, what is estimated, what is streaming, and what has not started", () => {
    expect(ringSource(ring())).toBe("Counted by the providers: 5K in, 1.1K out.");
    expect(ringSource(ring({ exact: false }))).toMatch(/^Estimated from the text/);
    expect(ringSource(ring({ live: true, exact: false }))).toMatch(/^Streaming now/);
    expect(ringSource(ring({ started: false }))).toMatch(/^Nothing has been sent yet/);
  });
});

describe("toolLine", () => {
  const none = { steps: 0, commands: 0, files: 0, searches: 0, pages: 0, spawned: 0, messages: 0 };
  it("lists only what the agent did, with the right plurals", () => {
    expect(toolLine(none)).toBe("");
    expect(toolLine({ ...none, steps: 1, commands: 3 })).toBe("1 step · 3 commands");
    expect(toolLine({ ...none, searches: 2, pages: 8, files: 1 })).toBe("1 file · 2 searches · 8 pages");
  });
  it("counts the Pals an agent sent out and the messages it sent, which is all UltraPal itself does", () => {
    expect(toolLine({ ...none, spawned: 1, messages: 1 })).toBe("1 Pal sent out · 1 message sent");
    expect(toolLine({ ...none, spawned: 3, messages: 4 })).toBe("3 Pals sent out · 4 messages sent");
  });
});

describe("doingLine", () => {
  const base = { model: "openai/gpt-oss-120b", step: null };
  it("names the model it is waiting for or hearing", () => {
    expect(doingLine({ ...base, doing: "waiting" })).toBe("Waiting to hear from gpt-oss-120b");
    expect(doingLine({ ...base, doing: "writing" })).toBe("Hearing gpt-oss-120b");
  });
  it("shows the step a working agent is on, or plain 'Working'", () => {
    expect(doingLine({ ...base, doing: "working", step: "Running node -v" })).toBe("Running node -v");
    expect(doingLine({ ...base, doing: "working" })).toBe("Working");
  });
  it("says nothing about an idle agent, and copes with no model yet", () => {
    expect(doingLine({ ...base, doing: null })).toBeNull();
    expect(doingLine({ model: null, step: null, doing: "waiting" })).toBe("Waiting to hear from the model");
  });
});
