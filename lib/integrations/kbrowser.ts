import Kernel from "@onkernel/sdk";
import { z } from "zod";
import type { El, Snapshot } from "@/lib/browse/snapshot";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";
import { assertPublicHttpUrl } from "./url-guard";

/** A live, visible cloud Chromium. `offX/offY` map page (client) coordinates to the screen the mouse API uses; measured per session. */
export interface LiveBrowser {
  id: string;
  liveViewUrl: string;
  offX: number;
  offY: number;
}

export const VIEWPORT = { width: 1280, height: 800 } as const;

const El_ = z.object({ i: z.number(), tag: z.string(), label: z.string(), role: z.string().optional(), href: z.string().optional(), type: z.string().optional(), x: z.number(), y: z.number() });
const Snap = z.object({ url: z.string(), title: z.string(), text: z.string(), elements: z.array(El_) });
const Pt = z.object({ x: z.number(), y: z.number() }).nullable();

/** Pure. Guards the shape coming back from the page; a malformed snapshot is a degrade, never a crash. */
export function parseSnapshot(raw: unknown): Snapshot | null {
  const p = Snap.safeParse(raw);
  return p.success ? p.data : null;
}

/** Pure. Page (client) coordinates -> screen coordinates, clamped inside the screen (the API 400s outside it). */
export function toScreen(x: number, y: number, b: Pick<LiveBrowser, "offX" | "offY">): { x: number; y: number } {
  const c = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max - 1);
  return { x: c(x + b.offX, VIEWPORT.width), y: c(y + b.offY, VIEWPORT.height) };
}

const SNAPSHOT_JS = `return await page.evaluate(() => {
  document.querySelectorAll("[data-sp-i]").forEach((e) => e.removeAttribute("data-sp-i"));
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[onclick]';
  const out = [];
  for (const e of document.querySelectorAll(sel)) {
    if (out.length >= 40) break;
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    if (r.width < 4 || r.height < 4 || st.visibility === "hidden" || st.display === "none" || r.bottom < 0 || r.top > innerHeight * 2.2 || r.right < 0 || r.left > innerWidth) continue;
    const pw = e.type === "password";
    const label = (e.innerText || e.getAttribute("aria-label") || e.placeholder || e.getAttribute("title") || e.getAttribute("alt") || (pw ? "" : e.value) || e.name || "").trim();
    const i = out.length;
    e.setAttribute("data-sp-i", String(i));
    out.push({ i, tag: e.tagName.toLowerCase(), label: pw ? "password" : label.slice(0, 120), role: e.getAttribute("role") || undefined, href: e.tagName === "A" ? e.href : undefined, type: e.type || undefined, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").replace(/\\s+\\n/g, "\\n").slice(0, 4000), elements: out };
});`;

const client = () => new Kernel({ apiKey: getEnv().KERNEL_API_KEY });

async function run(id: string, code: string, timeoutSec = 25): Promise<unknown> {
  const r = await client().browsers.playwright.execute(id, { timeout_sec: timeoutSec, code });
  if (!r.success) throw new Error(r.error ?? "browser script failed");
  return r.result;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Starts a visible browser and calibrates the mouse: a real click at a known screen point tells us where the page saw it. */
export async function openBrowser(signal?: AbortSignal): Promise<AdapterResult<LiveBrowser>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const k = client();
    const b = await k.browsers.create({ headless: false, timeout_seconds: 300, viewport: VIEWPORT }, { signal });
    if (!b.browser_live_view_url) {
      await k.browsers.deleteByID(b.session_id).catch(() => undefined);
      return degrade("kernel: no live view for this session");
    }
    try {
      await run(b.session_id, `await page.goto("about:blank"); await page.evaluate(() => { document.body.style.cssText = "margin:0;height:100vh"; window.__c = null; addEventListener("click", (e) => { window.__c = [e.clientX, e.clientY]; }, true); });`);
      await k.browsers.computer.setCursorVisibility(b.session_id, { hidden: false }).catch(() => undefined);
      await k.browsers.computer.clickMouse(b.session_id, { x: 640, y: 500 });
      await sleep(250);
      const hit = z.tuple([z.number(), z.number()]).nullable().parse(await run(b.session_id, `return await page.evaluate(() => window.__c);`));
      if (!hit) throw new Error("mouse calibration failed");
      return { ok: true, data: { id: b.session_id, liveViewUrl: b.browser_live_view_url, offX: 640 - hit[0], offY: 500 - hit[1] } };
    } catch (e) {
      await k.browsers.deleteByID(b.session_id).catch(() => undefined);
      throw e;
    }
  });
}

/** ALWAYS call this when a session ends; browsers bill while alive. Never `browser.close()`: that only drops the local connection. */
export async function closeBrowser(id: string): Promise<void> {
  if (isOn("kernel")) await client().browsers.deleteByID(id).catch(() => undefined);
}

/** Runs arbitrary Playwright on the session browser (server-side only; used for scripted flows like sandbox approval). */
export async function execBrowser(b: LiveBrowser, code: string, timeoutSec = 60): Promise<AdapterResult<unknown>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => ({ ok: true as const, data: await run(b.id, code, timeoutSec) }));
}

export async function snapshotPage(b: LiveBrowser): Promise<AdapterResult<Snapshot>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const s = parseSnapshot(await run(b.id, SNAPSHOT_JS));
    return s ? { ok: true, data: s } : degrade("kernel: unreadable page");
  });
}

/** Pure-ish. Public http(s) pages, plus the VM's OWN localhost (a dev server the terminal agent started inside the same cloud VM). Private ranges stay blocked. */
export function resolveNavUrl(url: string): string {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?(\/|$)/i.test(url.trim()) ? url.trim() : assertPublicHttpUrl(url);
}

export async function gotoUrl(b: LiveBrowser, url: string): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const safe = resolveNavUrl(url);
    await run(b.id, `await page.goto(${JSON.stringify(safe)}, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForTimeout(600);`, 30);
    return { ok: true, data: null };
  });
}

/** Smoothly moves the real, visible cursor onto element [index] (scrolling it into view first) and returns its screen point. */
async function hover(b: LiveBrowser, index: number): Promise<{ x: number; y: number }> {
  const pt = Pt.parse(await run(b.id, `const l = page.locator('[data-sp-i="${Math.trunc(index)}"]').first(); await l.scrollIntoViewIfNeeded({ timeout: 3000 }); const bb = await l.boundingBox(); return bb ? { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } : null;`));
  if (!pt) throw new Error(`element [${index}] is not on the page any more`);
  const s = toScreen(pt.x, pt.y, b);
  await client().browsers.computer.moveMouse(b.id, { ...s, smooth: true, duration_ms: 550 });
  return s;
}

const settle = (b: LiveBrowser) => run(b.id, `await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(700);`, 15);

export async function clickElement(b: LiveBrowser, el: El): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const s = await hover(b, el.i);
    await client().browsers.computer.clickMouse(b.id, s);
    await settle(b);
    return { ok: true, data: null };
  });
}

export async function typeInto(b: LiveBrowser, el: El, text: string, submit: boolean): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const s = await hover(b, el.i);
    const k = client().browsers.computer;
    await k.clickMouse(b.id, s);
    await run(b.id, `await page.locator('[data-sp-i="${Math.trunc(el.i)}"]').first().fill("");`, 8).catch(() => undefined);
    await k.typeText(b.id, { text, delay: 40 });
    if (submit) {
      await k.pressKey(b.id, { keys: ["Return"] });
      await settle(b);
    }
    return { ok: true, data: null };
  });
}

export async function scrollPage(b: LiveBrowser, direction: "down" | "up"): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    await client().browsers.computer.scroll(b.id, { x: 640, y: 400, delta_y: direction === "down" ? 600 : -600 });
    await sleep(500);
    return { ok: true, data: null };
  });
}
