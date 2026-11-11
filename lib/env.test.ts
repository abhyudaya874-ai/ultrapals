import { describe, expect, it } from "vitest";
import { withRenderUrl } from "./env";

describe("withRenderUrl: a Render deploy knows its own address", () => {
  it("uses RENDER_EXTERNAL_URL when APP_URL is not set, or is blank", () => {
    expect(withRenderUrl({ RENDER_EXTERNAL_URL: "https://ultrapals.onrender.com" }).APP_URL).toBe("https://ultrapals.onrender.com");
    expect(withRenderUrl({ APP_URL: "", RENDER_EXTERNAL_URL: "https://ultrapals.onrender.com" }).APP_URL).toBe("https://ultrapals.onrender.com");
  });
  it("never overrides an APP_URL that was set on purpose", () => {
    const e = { APP_URL: "https://demo.example.com", RENDER_EXTERNAL_URL: "https://ultrapals.onrender.com" };
    expect(withRenderUrl(e)).toBe(e);
  });
  it("changes nothing off Render", () => {
    const e = { DATABASE_URL: "x" };
    expect(withRenderUrl(e)).toBe(e);
    expect(withRenderUrl({ APP_URL: "http://localhost:3001" }).APP_URL).toBe("http://localhost:3001");
  });
  it("does not mutate what it was given", () => {
    const e: Record<string, string | undefined> = { RENDER_EXTERNAL_URL: "https://a.onrender.com" };
    withRenderUrl(e);
    expect(e.APP_URL).toBeUndefined();
  });
});
