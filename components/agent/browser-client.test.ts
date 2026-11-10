import { describe, expect, it, vi } from "vitest";
import { browserGet, browserPost, displayAddress, hostLabel } from "./browser-client";

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("browserGet", () => {
  it("returns what the server says", async () => {
    const state = { url: "https://a.test/", title: "A", canBack: false, canForward: false };
    expect(await browserGet("s1", reply({ alive: true, state }))).toEqual({ alive: true, state });
  });
  it("asks for this session, without caching", async () => {
    const f = reply({ alive: true });
    await browserGet("a b", f);
    expect(f).toHaveBeenCalledWith("/api/browser?sessionId=a%20b", { cache: "no-store" });
  });
  it("a closed browser is alive:false", async () => expect(await browserGet("s", reply({ alive: false, error: "the browser has closed" }))).toMatchObject({ alive: false }));
  it("a network error is NOT a closed browser", async () => {
    const r = await browserGet("s", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    expect(r).toMatchObject({ alive: true, ok: false });
    expect(r.error).toMatch(/Could not reach the app/);
  });
  it("a rate limit is not a closed browser either", async () => {
    const r = await browserGet("s", reply({ error: "slow down" }, 429));
    expect(r).toMatchObject({ alive: true, ok: false, error: "slow down" });
  });
  it("an unreadable answer is an error, not a crash", async () => {
    const r = await browserGet("s", (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch);
    expect(r).toMatchObject({ alive: true, ok: false });
  });
});

describe("browserPost", () => {
  it("sends the session and the operation", async () => {
    const f = reply({ ok: true, alive: true, search: true });
    const r = await browserPost("s1", { op: "goto", address: "kiro" }, f);
    expect(r).toMatchObject({ ok: true, search: true });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("/api/browser");
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: "s1", op: "goto", address: "kiro" });
  });
  it("keeps a refused address as an error the box can show", async () => {
    const r = await browserPost("s", { op: "goto", address: "file:///x" }, reply({ ok: false, alive: true, error: "Only http and https pages can be opened (not file:)." }, 400));
    expect(r).toEqual({ ok: false, alive: true, error: "Only http and https pages can be opened (not file:)." });
  });
  it("passes a new browser's live view back", async () => expect(await browserPost("s", { op: "open" }, reply({ ok: true, alive: true, liveViewUrl: "https://a.kernel.sh:8443/browser/live/T" }))).toMatchObject({ liveViewUrl: expect.stringContaining("kernel.sh") }));
  it("a network error is reported, not thrown", async () => expect(await browserPost("s", { op: "back" }, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toMatchObject({ alive: true, ok: false }));
});

describe("displayAddress / hostLabel", () => {
  it.each([["https://www.google.com/", "google.com"], ["https://docs.stripe.com/payments?x=1", "docs.stripe.com/payments?x=1"], ["http://localhost:8000/", "localhost:8000"], ["about:blank", ""], ["", ""]])("%s -> %s", (u, want) => expect(displayAddress(u)).toBe(want));
  it("names the site", () => {
    expect(hostLabel("https://www.google.com/search?q=kiro")).toBe("google.com");
    expect(hostLabel("not a url")).toBe("");
  });
});
