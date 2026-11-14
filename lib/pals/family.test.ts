import { describe, expect, it } from "vitest";
import { excludeFamilies, familyOf, familyOfBare } from "./family";

describe("familyOf", () => {
  it("reads the vendor prefix", () => {
    expect(familyOf("openai/gpt-oss-120b")).toBe("openai");
    expect(familyOf("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe("nvidia");
  });
  it("counts Google's own unprefixed ids as Google's, like OpenRouter's Gemma", () => {
    expect(familyOf("gemini-3-flash-preview")).toBe("google");
    expect(familyOf("gemma-4-26b-a4b-it")).toBe("google");
    expect(familyOf("google/gemma-4-31b-it:free")).toBe("google");
  });
  it("leaves any other unprefixed id as its own family", () => expect(familyOf("some-model")).toBe("some-model"));
  it("finds the family of a bare name callModel reports", () => {
    const roster = [{ provider: "gemini", model: "gemini-3.5-flash-lite" }, { provider: "groq", model: "openai/gpt-oss-20b" }] as const;
    expect(familyOfBare("gemini-3.5-flash-lite", roster)).toBe("google");
    expect(familyOfBare("gpt-oss-20b", roster)).toBe("openai");
  });
  it("a blind check that must not share a family with Google drops every Google model", () => {
    const roster = [{ provider: "gemini", model: "gemini-3-flash-preview" }, { provider: "openrouter", model: "google/gemma-4-31b-it:free" }, { provider: "groq", model: "openai/gpt-oss-120b" }] as const;
    expect(excludeFamilies(roster, new Set(["google"])).map((m) => m.model)).toEqual(["openai/gpt-oss-120b"]);
  });
});
