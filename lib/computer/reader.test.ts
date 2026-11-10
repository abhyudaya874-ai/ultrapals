import { describe, expect, it } from "vitest";
import { collect, mkDeps, mkSession, ok, page, scripted } from "./fakes";
import { readPage } from "./reader";

const LONG = "Refunds are supported for 30 days. ".repeat(20);
const fetchOk = (text: string) => async () => ({ ok: true as const, data: { text, status: 200, finalUrl: "https://docs.example.com/r" } });
const fetchBad = (reason: string) => async () => ({ ok: false as const, degraded: true as const, reason });
const ctx = (patch: object = {}, session = mkSession()) => ({ agent: "research-1", session, deps: mkDeps(scripted(["x"]).open, patch) });
const URL1 = "https://docs.example.com/r";

describe("readPage", () => {
  it("reads with a plain fetch first and never opens the browser when that is enough", async () => {
    let opened = 0;
    const { ev, ret } = await collect(readPage(ctx({ fetchPage: fetchOk(LONG), vm: { goto: async () => (opened++, ok(null)) } }), URL1, { allowBrowser: true }));
    expect(ret).toMatchObject({ via: "fetch", url: URL1 });
    expect(opened).toBe(0);
    expect(ev.some((e) => e.kind === "visit" && e.via === "fetch")).toBe(true);
  });
  it("falls back to the live browser when the page is thin, and shows the navigation (page event)", async () => {
    const c = ctx({ fetchPage: fetchOk("tiny"), vm: { goto: async () => ok(null), snapshot: async () => ok(page(URL1, "Refunds", LONG)) } });
    const { ev, ret } = await collect(readPage(c, URL1, { allowBrowser: true }));
    expect(ret).toMatchObject({ via: "browser" });
    expect(ev.filter((e) => e.kind === "page")).toEqual([expect.objectContaining({ url: URL1, title: "Refunds" })]);
    expect(c.session.browserReads).toBe(1);
  });
  it("then the terminal: curl from the VM when the browser could not read it", async () => {
    const c = ctx({ fetchPage: fetchBad("http 403"), vm: { goto: async () => ok(null), snapshot: async () => ok(page(URL1, "", "")) }, term: { exec: async () => ok({ exit: 0, out: `<html><body><p>${LONG}</p></body></html>`, ms: 5 }) } });
    const { ev, ret } = await collect(readPage(c, URL1, { allowBrowser: true }));
    expect(ret).toMatchObject({ via: "terminal" });
    const term = ev.filter((e) => e.kind === "term");
    expect(term[0]).toMatchObject({ state: "running" });
    expect(term.at(-1)).toMatchObject({ state: "ok", exit: 0 });
    expect(term[0].kind === "term" && term[0].command).toContain("curl");
  });
  it("without permission for the browser it reads thin text or gives up, and never starts a VM", async () => {
    let vm = 0;
    const c = ctx({ fetchPage: fetchOk("tiny"), vm: { open: async () => (vm++, ok(null)) } }, mkSession({ vm: null }));
    const r = await collect(readPage(c, URL1));
    expect(vm).toBe(0);
    expect(r.ret).toMatchObject({ text: "tiny" });
    expect((await collect(readPage(ctx({ fetchPage: fetchBad("http 500") }), URL1))).ret).toBeNull();
  });
  it("caps browser reads per conversation (it is slow and shared)", async () => {
    const session = mkSession();
    session.browserReads = 3;
    let opened = 0;
    const c = ctx({ fetchPage: fetchBad("http 403"), vm: { goto: async () => (opened++, ok(null)) } }, session);
    expect((await collect(readPage(c, URL1, { allowBrowser: true }))).ret).toBeNull();
    expect(opened).toBe(0);
  });
  it("an address the SSRF guard blocks is never opened by fetch, browser or terminal", async () => {
    let calls = 0;
    const c = ctx({ fetchPage: async () => (calls++, fetchBad("x")()), vm: { goto: async () => (calls++, ok(null)) }, term: { exec: async () => (calls++, ok({ exit: 0, out: "", ms: 1 })) } });
    for (const u of ["http://localhost:3000/", "http://169.254.169.254/latest", "http://10.1.1.1/", "file:///etc/hosts"]) expect((await collect(readPage(c, u, { allowBrowser: true }))).ret).toBeNull();
    expect(calls).toBe(0);
  });
  it("a browser that cannot start still lets the page read fall through without crashing", async () => {
    const c = ctx({ fetchPage: fetchBad("http 403"), vm: { open: async () => ({ ok: false as const, degraded: true as const, reason: "kernel off" }) } }, mkSession({ vm: null }));
    const { ev, ret } = await collect(readPage(c, URL1, { allowBrowser: true }));
    expect(ret).toBeNull();
    expect(ev.some((e) => e.kind === "step" && e.state === "error")).toBe(true);
  });
});
