import { releaseCloudComputer, startedCloudComputer, takeCloudComputer } from "@/lib/budget/kernel";
import Kernel from "@onkernel/sdk";
import { z } from "zod";
import type { BrowserKey } from "@/lib/browse/actions";
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
const Snap = z.object({ url: z.string(), title: z.string(), text: z.string(), elements: z.array(El_), scroll: z.object({ y: z.number(), height: z.number(), view: z.number() }).optional() });
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
  // A kiosk browser has no tabs a person could switch to, so links that would open a new tab open in this one.
  if (!window.__spInPlace) {
    window.__spInPlace = true;
    document.addEventListener("click", (ev) => { const a = ev.target && ev.target.closest ? ev.target.closest("a[target]") : null; if (a) a.target = "_self"; }, true);
    window.open = (u) => { if (u) location.href = String(u); return null; };
  }
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[role=textbox],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
  const found = [];
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    if (r.width < 4 || r.height < 4 || st.visibility === "hidden" || st.display === "none" || st.pointerEvents === "none" || r.bottom < 0 || r.top > innerHeight * 2.2 || r.right < 0 || r.left > innerWidth) continue;
    if (e.disabled || e.getAttribute("aria-hidden") === "true") continue;
    found.push({ e, r, onScreen: r.top < innerHeight && r.bottom > 0 });
  }
  // what is on screen now comes first, so a long page's header links do not use up the list before the part the person sees
  found.sort((a, b) => Number(b.onScreen) - Number(a.onScreen));
  const out = [];
  for (const { e, r } of found) {
    if (out.length >= 45) break;
    const pw = e.type === "password";
    const lab = e.labels && e.labels[0] ? e.labels[0].innerText : "";
    const label = (e.innerText || e.getAttribute("aria-label") || e.placeholder || lab || e.getAttribute("title") || e.getAttribute("alt") || (pw ? "" : e.value) || e.name || "").trim();
    const i = out.length;
    e.setAttribute("data-sp-i", String(i));
    const opts = e.tagName === "SELECT" ? " [" + Array.from(e.options).slice(0, 8).map((o) => o.text.trim()).join(" | ") + "]" : "";
    out.push({ i, tag: e.tagName.toLowerCase(), label: (pw ? "password" : label.replace(/\\s+/g, " ").slice(0, 110)) + opts, role: e.getAttribute("role") || undefined, href: e.tagName === "A" ? e.href : undefined, type: e.type || undefined, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  const de = document.documentElement;
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").replace(/\\s+\\n/g, "\\n").slice(0, 4000), elements: out, scroll: { y: Math.round(scrollY), height: Math.round(Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0)), view: innerHeight } };
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
  // A browser bills while it is alive and a public link lets anyone start one: take a place first (lib/budget), give it back if the start fails.
  const key = crypto.randomUUID();
  const place = takeCloudComputer(key);
  if (!place.ok) return degrade(`kernel: ${place.why}`);
  const opened = await openBrowserWithPlace(signal);
  if (opened.ok) startedCloudComputer(key, opened.data.id);
  else releaseCloudComputer(key);
  return opened;
}
async function openBrowserWithPlace(signal?: AbortSignal): Promise<AdapterResult<LiveBrowser>> {
  return guard("kernel", async () => {
    const k = client();
    // Kiosk mode: the live view shows only the page (the app draws its own address bar and buttons). The 10 minute inactivity limit is longer than
    // the session's own idle limit (8 minutes), so a browser is never deleted behind the app's back while it is still being used.
    const b = await k.browsers.create({ headless: false, kiosk_mode: true, timeout_seconds: 600, viewport: VIEWPORT }, { signal });
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
  releaseCloudComputer(id);
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

/** Pure. Playwright's error text without its "Call log:" tail and without the stack, so it can be shown to a person or a model. */
export const plainError = (m: string): string => m.split(/\n\s*Call log:/i)[0].replace(/^kernel:\s*/i, "").replace(/^page\.goto:\s*/i, "").trim().slice(0, 200);

export async function gotoUrl(b: LiveBrowser, url: string): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  const r = await guard("kernel", async () => {
    const safe = resolveNavUrl(url);
    await run(b.id, `await page.goto(${JSON.stringify(safe)}, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForTimeout(600);`, 30);
    return { ok: true as const, data: null };
  });
  return r.ok ? r : { ...r, reason: plainError(r.reason) };
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

export async function scrollPage(b: LiveBrowser, direction: "down" | "up", to?: "top" | "bottom"): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    if (to) await run(b.id, `await page.evaluate((t) => window.scrollTo({ top: t === "top" ? 0 : document.documentElement.scrollHeight, behavior: "instant" }), ${JSON.stringify(to)});`, 10);
    else await client().browsers.computer.scroll(b.id, { x: 640, y: 400, delta_y: direction === "down" ? 600 : -600 });
    await sleep(500);
    return { ok: true as const, data: null };
  });
}

/** Where the browser is now, and whether Back and Forward have somewhere to go. */
export interface BrowserState { url: string; title: string; canBack: boolean; canForward: boolean }
const StateS = z.object({ url: z.string(), title: z.string(), canBack: z.boolean(), canForward: z.boolean() });

const STATE_JS = `const s = await context.newCDPSession(page);
const h = await s.send("Page.getNavigationHistory").catch(() => null);
await s.detach().catch(() => {});
let title = ""; try { title = await page.title(); } catch {}
const cur = h ? h.currentIndex : 0;
const here = h && h.entries[cur] ? h.entries[cur] : null;
// a page that failed to load is shown by the browser as an error page; the address a person typed is still in the history
const url = page.url().startsWith("chrome-error:") && here ? (here.userTypedURL || here.url) : page.url();
return { url, title, canBack: !!h && cur > 0 && h.entries[cur - 1].url !== "about:blank", canForward: !!h && cur < h.entries.length - 1 };`;

export async function browserState(b: LiveBrowser): Promise<AdapterResult<BrowserState>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const p = StateS.safeParse(await run(b.id, STATE_JS, 15));
    return p.success ? { ok: true as const, data: p.data } : degrade("kernel: unreadable browser state");
  });
}

/**
 * Back, forward or reload, like the buttons of a browser. Back and forward go through the browser's own history (a page restored from its cache
 * fires no load event, so waiting for one would stall for the whole timeout). A step with nowhere to go leaves the page where it is.
 */
export async function navigate(b: LiveBrowser, op: "back" | "forward" | "reload"): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const code = op === "reload"
      ? `await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null); await page.waitForTimeout(500);`
      : `const s = await context.newCDPSession(page);
         const h = await s.send("Page.getNavigationHistory");
         const e = h.entries[h.currentIndex + (${op === "back" ? -1 : 1})];
         if (e && e.url !== "about:blank") await s.send("Page.navigateToHistoryEntry", { entryId: e.id });
         await s.detach().catch(() => {});
         await page.waitForTimeout(700);`;
    await run(b.id, code, 20);
    return { ok: true as const, data: null };
  });
}

/** Names the model uses for keys -> the names the computer API takes. */
export const KEY_NAMES: Record<BrowserKey, string> = { Enter: "Return", Tab: "Tab", Escape: "Escape", Backspace: "BackSpace", Space: "space", ArrowDown: "Down", ArrowUp: "Up", ArrowLeft: "Left", ArrowRight: "Right", PageDown: "Page_Down", PageUp: "Page_Up", Home: "Home", End: "End" };

export async function pressKey(b: LiveBrowser, key: BrowserKey): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    await client().browsers.computer.pressKey(b.id, { keys: [KEY_NAMES[key]] });
    await sleep(key === "Enter" ? 900 : 350);
    return { ok: true as const, data: null };
  });
}

export async function waitSeconds(b: LiveBrowser, seconds: number): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    await run(b.id, `await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(${Math.max(1, Math.min(8, Math.round(seconds))) * 1000});`, 20);
    return { ok: true as const, data: null };
  });
}

const FoundS = z.object({ found: z.boolean(), context: z.string() });
/** Finds text on the page, scrolls it into view and returns the text around it (what a person does with Ctrl+F). */
export async function findText(b: LiveBrowser, text: string): Promise<AdapterResult<{ found: boolean; context: string }>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const r = FoundS.safeParse(await run(b.id, `const loc = page.getByText(${JSON.stringify(text)}, { exact: false }).first();
      if (!(await loc.count())) return { found: false, context: "" };
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const around = await loc.evaluate((e) => (e.closest("p,li,td,tr,section,article,div") || e).innerText.replace(/\\s+/g, " ").slice(0, 500)).catch(() => "");
      return { found: true, context: around };`, 15));
    return r.success ? { ok: true as const, data: r.data } : degrade("kernel: unreadable find result");
  });
}

export async function selectOption(b: LiveBrowser, el: El, option: string): Promise<AdapterResult<null>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    await run(b.id, `const l = page.locator('[data-sp-i="${Math.trunc(el.i)}"]').first(); await l.selectOption({ label: ${JSON.stringify(option)} }).catch(async () => { await l.selectOption(${JSON.stringify(option)}); });`, 12);
    await settle(b);
    return { ok: true as const, data: null };
  });
}

/** Whether Kernel still has this browser. It deletes one after ten minutes without use, and its live view then only says "Session not found". Network trouble counts as alive: do not throw a browser away over a blip. */
export async function vmAlive(b: LiveBrowser): Promise<boolean> {
  if (!isOn("kernel")) return false;
  try {
    await client().browsers.retrieve(b.id);
    return true;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return !(status === 404 || status === 410);
  }
}
