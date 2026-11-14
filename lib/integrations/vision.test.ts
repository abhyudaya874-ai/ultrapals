import { describe, expect, it } from "vitest";
import { isAllowedModel } from "./chat";
import { VISION_MODELS, visionBody, visionText } from "./vision";

const img = { name: "a.png", mime: "image/png" as const, data: "AAAA" };

describe("vision models", () => {
  it("are all on their provider's allowlist, Google's free Gemini 3 Flash first", () => {
    for (const m of VISION_MODELS) expect(isAllowedModel(m.provider, m.model), `${m.provider} ${m.model}`).toBe(true);
    expect(VISION_MODELS[0]).toEqual({ provider: "gemini", model: "gemini-3-flash-preview" });
  });
  it("send the instruction, then each picture as a data URL; only Gemini is told to think briefly", () => {
    const g = visionBody("gemini-3-flash-preview", "What is here?", [img], "gemini");
    expect(g).toMatchObject({ model: "gemini-3-flash-preview", max_tokens: 900, reasoning_effort: "low" });
    expect(g.messages[0].content).toEqual([{ type: "text", text: "What is here?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
    expect(visionBody("google/gemma-4-31b-it:free", "x", [img])).not.toHaveProperty("reasoning_effort");
  });
  it("read the reply's text, and call an empty one empty", () => {
    expect(visionText({ choices: [{ message: { content: " A dark sidebar. ", role: "assistant", extra_content: {} } }] })).toBe("A dark sidebar.");
    expect(visionText({ choices: [{ message: { content: "" } }] })).toBeNull();
    expect(visionText({ error: { code: 503 } })).toBeNull();
  });
});
