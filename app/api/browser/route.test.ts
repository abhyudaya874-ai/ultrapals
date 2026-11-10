import { beforeEach, describe, expect, it, vi } from "vitest";

const VM = { id: "vm-1", liveViewUrl: "https://a.kernel.sh:8443/browser/live/T", offX: 0, offY: 0 };
const VM2 = { id: "vm-2", liveViewUrl: "https://b.kernel.sh:8443/browser/live/U", offX: 0, offY: 0 };

const k = vi.hoisted(() => ({
  vmAlive: vi.fn(async (_b: unknown) => true),
  gotoUrl: vi.fn(async (_b: unknown, _u: string) => ({ ok: true as const, data: null })),
  navigate: vi.fn(async (_b: unknown, _op: string) => ({ ok: true as const, data: null })),
  browserState: vi.fn(async (_b?: unknown) => ({ ok: true as const, data: { url: "https://example.com/", title: "Example", canBack: true, canForward: false } })),
  openBrowser: vi.fn(async (_signal?: AbortSignal): Promise<{ ok: true; data: { id: string; liveViewUrl: string; offX: number; offY: number } } | { ok: false; degraded: true; reason: string }> => ({ ok: true, data: { id: "vm-2", liveViewUrl: "https://b.kernel.sh:8443/browser/live/U", offX: 0, offY: 0 } })),
}));
// The route reaches the rest of the Kernel adapter through the agent's default dependencies, so only the calls under test are replaced.
vi.mock("@/lib/integrations/kbrowser", async (original) => ({ ...(await original<typeof import("@/lib/integrations/kbrowser")>()), ...k }));

import { resetRateLimit } from "@/lib/research/rate-limit";
import { endSession, getSession } from "@/lib/computer/session";
import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("http://t/api/browser", { method: "POST", body: JSON.stringify(body) }));
const get = (id: string) => GET(new Request(`http://t/api/browser?sessionId=${id}`));
const close = async () => undefined;

let sid = "";
beforeEach(async () => {
  resetRateLimit();
  Object.values(k).forEach((f) => f.mockClear());
  k.vmAlive.mockImplementation(async () => true);
  const s = getSession(undefined, close);
  s.vm = VM;
  sid = s.id;
  return () => { void endSession(sid, close); };
});

describe("GET /api/browser: where the browser is", () => {
  it("returns the address, title and whether Back and Forward can go", async () => {
    const r = await get(sid);
    expect(await r.json()).toEqual({ alive: true, state: { url: "https://example.com/", title: "Example", canBack: true, canForward: false } });
  });
  it("says alive:false (not an error) once Kernel has deleted the browser, and forgets it so the next agent step starts a new one", async () => {
    k.vmAlive.mockImplementation(async () => false);
    const r = await get(sid);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ alive: false, error: "the browser has closed" });
    expect(getSession(sid, close).vm).toBeNull();
  });
  it("an unknown or malformed session id is refused", async () => {
    expect(((await get("00000000-0000-4000-8000-000000000000")).status)).toBe(200);
    expect(await (await get("00000000-0000-4000-8000-000000000000")).json()).toMatchObject({ alive: false, error: "session expired" });
    expect((await get("nope")).status).toBe(400);
  });
  it("a conversation that has not opened a browser yet has none to show", async () => {
    const s = getSession(undefined, close);
    expect((await get(s.id)).status).toBe(404);
    void endSession(s.id, close);
  });
});

describe("POST /api/browser: the address bar and the buttons", () => {
  it("opens an address, and says it was a search when it was words", async () => {
    const a = await (await post({ sessionId: sid, op: "goto", address: "google.com" })).json();
    expect(k.gotoUrl).toHaveBeenCalledWith(VM, "https://google.com/");
    expect(a).toMatchObject({ ok: true, alive: true, search: false, state: { url: "https://example.com/" } });
    const b = await (await post({ sessionId: sid, op: "goto", address: "kiro pricing" })).json();
    expect(k.gotoUrl).toHaveBeenLastCalledWith(VM, "https://www.google.com/search?q=kiro%20pricing");
    expect(b.search).toBe(true);
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "data:text/html,x"])("refuses %s without touching the browser", async (address) => {
    const r = await post({ sessionId: sid, op: "goto", address });
    expect(r.status).toBe(400);
    expect(k.gotoUrl).not.toHaveBeenCalled();
  });
  it.each(["back", "forward", "reload"])("%s goes to the browser's own history", async (op) => {
    const r = await (await post({ sessionId: sid, op })).json();
    expect(k.navigate).toHaveBeenCalledWith(VM, op);
    expect(r.ok).toBe(true);
  });
  it("reports a page that would not load, with the browser's state, instead of failing", async () => {
    k.gotoUrl.mockImplementationOnce(async () => ({ ok: false as never, reason: "net::ERR_NAME_NOT_RESOLVED" } as never));
    const r = await (await post({ sessionId: sid, op: "goto", address: "nope.invalid" })).json();
    expect(r).toMatchObject({ ok: false, alive: true, error: "net::ERR_NAME_NOT_RESOLVED", state: { url: "https://example.com/" } });
  });
  it("tells the window when the browser has closed", async () => {
    k.vmAlive.mockImplementation(async () => false);
    const r = await (await post({ sessionId: sid, op: "reload" })).json();
    expect(r).toMatchObject({ ok: false, alive: false });
    expect(k.navigate).not.toHaveBeenCalled();
  });
  it("rejects a malformed request and an unknown operation", async () => {
    expect((await post({ sessionId: sid, op: "delete" })).status).toBe(400);
    expect((await post({ op: "back" })).status).toBe(400);
    expect((await post("nonsense")).status).toBe(400);
    expect((await post({ sessionId: sid, op: "goto", address: "x".repeat(2200) })).status).toBe(400);
  });
  it("limits how often it can be used", async () => {
    let last = 200;
    for (let i = 0; i < 45; i++) last = (await post({ sessionId: sid, op: "reload" })).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/browser: open a new browser", () => {
  it("starts one for a conversation that has none and returns its live view", async () => {
    const s = getSession(undefined, close);
    const r = await (await post({ sessionId: s.id, op: "open" })).json();
    expect(k.openBrowser).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, alive: true, liveViewUrl: VM2.liveViewUrl, state: { url: "https://example.com/" } });
    expect(getSession(s.id, close).vm?.id).toBe("vm-2");
    void endSession(s.id, close);
  });
  it("confirms the browser it already has instead of paying for another", async () => {
    const r = await (await post({ sessionId: sid, op: "open" })).json();
    expect(k.openBrowser).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, alive: true });
  });
  it("replaces a browser Kernel has deleted", async () => {
    k.vmAlive.mockImplementation(async () => false);
    const r = await (await post({ sessionId: sid, op: "open" })).json();
    expect(k.openBrowser).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, liveViewUrl: VM2.liveViewUrl });
    expect(getSession(sid, close).vm?.id).toBe("vm-2");
  });
  it("says so when Kernel cannot start one", async () => {
    const s = getSession(undefined, close);
    k.openBrowser.mockImplementationOnce(async () => ({ ok: false as const, degraded: true as const, reason: "kernel off" }));
    const r = await (await post({ sessionId: s.id, op: "open" })).json();
    expect(r).toMatchObject({ ok: false, alive: false });
    expect(r.error).toContain("could not start");
    void endSession(s.id, close);
  });
  it("an expired conversation is reported, not crashed on", async () => {
    const r = await (await post({ sessionId: "00000000-0000-4000-8000-000000000000", op: "open" })).json();
    expect(r).toMatchObject({ ok: false, alive: false, error: "session expired" });
    expect(k.openBrowser).not.toHaveBeenCalled();
  });
  it("rations new browsers harder than other actions (they cost money while they live)", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ sessionId: sid, op: "open" })).status);
    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
