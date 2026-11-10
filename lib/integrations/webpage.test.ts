import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPageText } from "./webpage";

const html = (s: string, status = 200, headers: Record<string, string> = {}) => new Response(s, { status, headers: { "content-type": "text/html", ...headers } });
afterEach(() => vi.unstubAllGlobals());

describe("fetchPageText", () => {
  it("reads a page as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html("<html><body><h1>Refunds</h1><p>30 days.</p></body></html>")));
    const r = await fetchPageText("https://docs.example.com/refunds");
    expect(r).toEqual({ ok: true, data: { text: "Refunds\n30 days.", status: 200, finalUrl: "https://docs.example.com/refunds" } });
  });
  it("never requests a private or local address", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const u of ["http://localhost:3000/", "http://127.0.0.1/x", "http://169.254.169.254/latest", "http://10.0.0.5/", "file:///etc/passwd"]) {
      const r = await fetchPageText(u);
      expect(r.ok).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("re-validates every redirect hop: a redirect to the metadata address is blocked", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", f);
    const r = await fetchPageText("https://docs.example.com/x");
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("follows a safe redirect", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/new" } })).mockResolvedValueOnce(html("<p>moved here</p>"));
    vi.stubGlobal("fetch", f);
    const r = await fetchPageText("https://docs.example.com/old");
    expect(r.ok && r.data.finalUrl).toBe("https://docs.example.com/new");
  });
  it("degrades on 403, on binary content and on a redirect loop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html("no", 403)));
    expect((await fetchPageText("https://docs.example.com/a"))).toMatchObject({ ok: false, reason: "http 403" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-type": "application/pdf" } })));
    expect(await fetchPageText("https://docs.example.com/a")).toMatchObject({ ok: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://docs.example.com/loop" } })));
    expect(await fetchPageText("https://docs.example.com/a")).toMatchObject({ ok: false, reason: "too many redirects" });
  });
});
