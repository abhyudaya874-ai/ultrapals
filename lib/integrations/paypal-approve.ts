import { approveUrlFor } from "@/lib/paypal";
import { getEnv } from "@/lib/env";
import { execBrowser, type LiveBrowser } from "./kbrowser";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";

const J = (s: string) => JSON.stringify(s);

/**
 * Scripted sandbox-buyer approval, driven on the session's LIVE browser so the user watches it happen (O7).
 * The buyer credentials come from getEnv() and are embedded only in the Playwright code sent to KERNEL —
 * a model never sees them; it only learns "approved" or "failed" afterwards.
 *
 * Hard-won PayPal facts (verified live): the login form contains a HONEYPOT password input
 * (aria-hidden="true", tabindex=-1) that must be excluded; programmatic fill() is cleared by the
 * hardened field, so credentials go in via pressSequentially (real keystrokes); two checkout UIs
 * exist (/pay/checkout #one-time-cta, /webapps/hermes "Complete Purchase") and bare <button> elements
 * have no type attribute, so buttons are matched by text/id, never type=submit or first().
 * Best-effort: PayPal's bot detection makes this flaky, so failure degrades to the manual approve URL.
 */
export async function approveOrderOnBrowser(b: LiveBrowser, orderId: string): Promise<AdapterResult<{ finalUrl: string }>> {
  if (!isOn("kernel")) return degrade("kernel off");
  const email = getEnv().PAYPAL_SANDBOX_BUYER_EMAIL;
  const password = getEnv().PAYPAL_SANDBOX_BUYER_PASSWORD;
  if (!email || !password) return degrade("sandbox buyer credentials not configured");

  return guard("kernel", async () => {
    const code =
      `const esel = 'input[name="login_email"]:not([aria-hidden="true"]):visible, #email:visible';` +
      `const psel = 'input[name="login_password"]:not([aria-hidden="true"]):visible, input[type="password"]:not([aria-hidden="true"]):visible';` +
      `const dumpState = async () => ({ url: page.url(), pwCount: await page.locator(psel).count(), buttons: await page.locator("button").evaluateAll(els => els.slice(0, 14).map(e => ({ id: e.id, text: (e.innerText || "").slice(0, 40) }))) });` +
      `await page.goto(${J(approveUrlFor(orderId))}, { waitUntil: "domcontentloaded", timeout: 45000 });` +
      `await page.waitForSelector(esel, { timeout: 45000 });` +
      `await page.locator(esel).first().click({ timeout: 5000 }); await page.locator(esel).first().pressSequentially(${J(email)}, { delay: 40 }); await page.waitForTimeout(700);` +
      `await page.keyboard.press("Enter"); await page.waitForTimeout(4000);` +
      // If still on the email step, click Next/Avançar once (real keystrokes already updated React state).
      `if ((await page.locator(psel).count()) === 0 && await page.locator(esel).first().isVisible().catch(() => false)) { await page.locator('#btnNext, button:has-text("Next"), button:has-text("Continuar"), button:has-text("Avançar"), button:has-text("Continue")').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(4000); }` +
      `await page.waitForSelector(psel, { timeout: 15000 }).catch(() => {});` +
      `if ((await page.locator(psel).count()) === 0) return { finalUrl: page.url(), stuck: "no password field: " + (await page.innerText("body")).slice(0, 500), dump: await dumpState() };` +
      `await page.locator(psel).first().click({ timeout: 5000 }); await page.locator(psel).first().pressSequentially(${J(password)}, { delay: 40 }); await page.waitForTimeout(800);` +
      // React hydration can wipe a fast fill; verify the value landed and retype once if the field is empty.
      `if ((await page.locator(psel).first().inputValue().catch(() => "")) === "") { await page.locator(psel).first().click({ timeout: 5000 }); await page.locator(psel).first().pressSequentially(${J(password)}, { delay: 70 }); await page.waitForTimeout(800); }` +
      `const dump = await dumpState();` +
      `await page.keyboard.press("Enter"); await page.waitForTimeout(5000);` +
      `if (await page.locator(psel).first().isVisible().catch(() => false)) { await page.locator('#btnLogin, button:has-text("Log In"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Entrar")').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(4000); }` +
      `if (await page.locator(psel).first().isVisible().catch(() => false)) { await page.keyboard.press("Enter"); await page.waitForTimeout(3000); }` +
      `if (await page.locator(psel).first().isVisible().catch(() => false)) return { finalUrl: page.url(), stuck: "password submit failed: " + (await page.innerText("body")).slice(0, 400), dump };` +
      `const cta = '#one-time-cta, button:has-text("Complete Purchase"), button:has-text("Pay Now")';` +
      `let pay = false;` +
      `for (let i = 0; i < 10 && !pay; i++) { await page.waitForTimeout(3500); pay = (await page.locator(cta).count()) > 0; if (!pay && (i === 3 || i === 7)) await page.locator('button:has-text("Continue"), button:has-text("Agree")').first().click({ timeout: 3000 }).catch(() => {}); }` +
      `if (!pay) return { finalUrl: page.url(), stuck: "no pay cta: " + (await page.innerText("body")).slice(0, 500), dump };` +
      `await page.locator(cta).first().click({ timeout: 10000 }); await page.waitForTimeout(6000);` +
      `return { finalUrl: page.url() };`;

    const r = await execBrowser(b, code, 150);
    if (!r.ok) return r;
    const d = r.data as { finalUrl?: unknown; stuck?: unknown; dump?: unknown };
    const finalUrl = typeof d?.finalUrl === "string" ? d.finalUrl : "";
    if (typeof d?.stuck === "string") return degrade(`approval stuck: ${d.stuck.slice(0, 140)} :: ${JSON.stringify(d.dump ?? {}).slice(0, 600)}`);
    return { ok: true as const, data: { finalUrl } };
  });
}
