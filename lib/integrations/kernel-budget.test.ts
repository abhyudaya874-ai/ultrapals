import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// KERNEL bills a browser for as long as it is alive and a public link lets anyone start one. These tests pin the wiring of the spending guard
// (lib/budget) into the two places that create browsers, with the SDK replaced so nothing is ever started for real.
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  del: vi.fn(async (_id: string) => undefined),
  exec: vi.fn(),
}));
vi.mock("@onkernel/sdk", () => ({
  default: class {
    browsers = {
      create: sdk.create,
      deleteByID: sdk.del,
      replays: { start: async () => ({ replay_id: "r1", replay_view_url: "https://replay" }), stop: async () => undefined },
      computer: { setCursorVisibility: async () => undefined, clickMouse: async () => undefined },
      playwright: { execute: sdk.exec },
    };
  },
}));

let kb: typeof import("./kbrowser");
let kn: typeof import("./kernel");
let budget: typeof import("@/lib/budget/kernel");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("PAYPAL_CLIENT_ID", "x");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "y");
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("CAP_KERNEL", "1");
  vi.stubEnv("KERNEL_API_KEY", "k");
  vi.stubEnv("KERNEL_MAX_BROWSERS", "1");
  vi.stubEnv("KERNEL_MAX_PER_DAY", "3");
  kb = await import("./kbrowser");
  kn = await import("./kernel");
  budget = await import("@/lib/budget/kernel");
});

let n = 0;
beforeEach(() => {
  budget.resetCloudComputers();
  sdk.create.mockReset();
  sdk.del.mockClear();
  sdk.exec.mockReset();
  sdk.create.mockImplementation(async () => ({ session_id: `kb-${++n}`, browser_live_view_url: "https://live/x" }));
  sdk.exec.mockImplementation(async () => ({ success: true, result: [640, 500] }));
});

describe("openBrowser takes a place before it creates anything", () => {
  it("starts one, refuses a second while the first is alive, and creates nothing for the refused one", async () => {
    const a = await kb.openBrowser();
    expect(a.ok).toBe(true);
    const b = await kb.openBrowser();
    expect(b.ok).toBe(false);
    expect(!b.ok && b.reason).toMatch(/already running.*limit for this demo \(1\)/);
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });
  it("gives the place back when the browser is closed", async () => {
    const a = await kb.openBrowser();
    if (!a.ok) throw new Error("expected a browser");
    await kb.closeBrowser(a.data.id);
    expect(sdk.del).toHaveBeenCalledWith(a.data.id);
    expect((await kb.openBrowser()).ok).toBe(true);
  });
  it("gives the place back when the start fails, so one failure does not lock everyone out", async () => {
    sdk.create.mockRejectedValueOnce(new Error("boom"));
    expect((await kb.openBrowser()).ok).toBe(false);
    expect((await kb.openBrowser()).ok).toBe(true);
  });
  it("stops at the day's budget even when every browser was closed in time", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await kb.openBrowser();
      if (!r.ok) throw new Error(`start ${i + 1} should have worked: ${r.reason}`);
      await kb.closeBrowser(r.data.id);
    }
    const fourth = await kb.openBrowser();
    expect(fourth.ok).toBe(false);
    expect(!fourth.ok && fourth.reason).toMatch(/budget of 3 cloud computers is used up/);
    expect(sdk.create).toHaveBeenCalledTimes(3);
  });
});

describe("observePage (the page read behind a promise) is under the same guard", () => {
  const read = () => kn.observePage("https://example.com/");
  it("is refused, without creating a browser, while the live browser holds the only place", async () => {
    const live = await kb.openBrowser();
    expect(live.ok).toBe(true);
    sdk.create.mockClear();
    const r = await read();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/limit for this demo/);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("deletes its browser and gives the place back when it is done, whether the read worked or not", async () => {
    sdk.exec.mockResolvedValueOnce({ success: true, result: { text: "hello" } });
    expect((await read()).ok).toBe(true);
    expect(sdk.del).toHaveBeenCalledTimes(1);
    sdk.exec.mockResolvedValueOnce({ success: false, error: "page crashed" });
    expect((await read()).ok).toBe(false);
    expect(sdk.del).toHaveBeenCalledTimes(2);
    expect((await kb.openBrowser()).ok).toBe(true); // the place is free again
  });
  it("gives the place back when the browser could not even be created", async () => {
    sdk.create.mockRejectedValueOnce(new Error("no capacity"));
    expect((await read()).ok).toBe(false);
    expect((await kb.openBrowser()).ok).toBe(true);
  });
});
