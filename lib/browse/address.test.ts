import { describe, expect, it } from "vitest";
import { SEARCH_URL, normalizeAddress } from "./address";

describe("normalizeAddress: web addresses", () => {
  it.each([
    ["https://google.com", "https://google.com/"],
    ["http://example.com/a?b=1#c", "http://example.com/a?b=1#c"],
    ["google.com", "https://google.com/"],
    ["www.google.com/search?q=kiro", "https://www.google.com/search?q=kiro"],
    ["  docs.stripe.com/payments  ", "https://docs.stripe.com/payments"],
    ["example.com:8080/x", "https://example.com:8080/x"],
    ["localhost:8000", "http://localhost:8000/"],
    ["127.0.0.1:3000/app", "http://127.0.0.1:3000/app"],
  ])("%s -> %s", (input, url) => expect(normalizeAddress(input)).toEqual({ ok: true, url, search: false }));
});

describe("normalizeAddress: searches", () => {
  it.each(["kiro", "kiro ide pricing", "what is l402?", "paypal fees 2026", "a.b"])("%s is searched for", (q) => {
    const r = normalizeAddress(q);
    expect(r).toEqual({ ok: true, url: `${SEARCH_URL}${encodeURIComponent(q)}`, search: true });
  });
  it("words with a dot in them are a search, not a website", () => expect(normalizeAddress("is paypal.com safe")).toMatchObject({ search: true }));
});

describe("normalizeAddress: refusals", () => {
  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x", "chrome://settings", "ftp://x.test/a", "about:blank", "view-source:https://x.test"])("refuses %s", (u) => {
    const r = normalizeAddress(u);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/Only http and https/);
  });
  it("refuses empty and huge input", () => {
    expect(normalizeAddress("   ").ok).toBe(false);
    expect(normalizeAddress("x".repeat(2001)).ok).toBe(false);
  });
  it("refuses an address with no website name", () => expect(normalizeAddress("http://").ok).toBe(false));
});
