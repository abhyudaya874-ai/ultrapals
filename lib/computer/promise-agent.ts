import { articleBySlug, ARTICLES, type NewsArticle } from "@/lib/newsroom";
import { approveUrlFor } from "@/lib/paypal";
import type { AdapterResult } from "@/lib/integrations/types";
import { ensureVm, type SubCtx } from "./ctx";
import type { CEvent } from "./events";
import type { PromiseRunLog } from "@/lib/pals/measure";
import type { PromiseInfo } from "./promise-ops";

const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "article", "story", "premium", "unlock", "open", "read", "please", "about", "from", "into",
  "what", "when", "where", "your", "you", "can", "could", "would", "should", "promise", "pay", "payment", "cost", "price",
  // task-instruction words that are not content signals
  "return", "provide", "list", "create", "standing", "titled", "slug", "need", "want", "give", "make", "using", "use", "id", "url", "via", "per",
]);

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2);
const bare = (w: string) => w.replace(/s$/, "");
const words = (s: string) => new Set(tokens(s).map(bare).filter((w) => !STOP.has(w)));

/**
 * Pure. Best article match for a natural-language task: exact slug/title substring wins, else weighted token
 * overlap — slug words count 3, title words 2, dek words 1 — with STOP words removed from BOTH sides so
 * instruction words like "return the promise id" cannot match an article's title. Null when nothing scores.
 */
export function matchArticle(task: string): NewsArticle | null {
  const t = task.toLowerCase();
  for (const a of ARTICLES) if (t.includes(a.slug) || t.includes(a.title.toLowerCase())) return a;
  const tt = words(task);
  let best: { a: NewsArticle; score: number } | null = null;
  for (const a of ARTICLES) {
    const slug = words(a.slug.replace(/-/g, " "));
    const title = words(a.title);
    const dek = words(a.dek);
    const score =
      [...slug].filter((w) => tt.has(w)).length * 3 +
      [...title].filter((w) => tt.has(w)).length * 2 +
      [...dek].filter((w) => tt.has(w)).length;
    if (score >= 4 && (!best || score > best.score)) best = { a, score };
  }
  return best?.a ?? null;
}

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(u);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fmtPromise(p: PromiseInfo): string {
  const usd = p.currency === "USD" ? `$${(p.amountMinor / 100).toFixed(2)}` : `${p.amountMinor} ${p.currency}`;
  const cond = p.condition.kind === "page_contains" ? `page_contains ${String((p.condition as { url?: string }).url ?? "")}`.slice(0, 90) : p.condition.kind;
  return `"${p.title}" — ${usd}, state ${p.state}, window ends ${p.windowEndsAt.toISOString().slice(0, 16)}Z, condition ${cond}`;
}

/**
 * The promise subagent: the only agent allowed to move money, and only through /api/promise (create -> approve ->
 * settle). For paywalled articles it runs the whole CrawlerPal beat: create a $0.01 promise conditioned on the
 * article's proof URL, approve the sandbox order on the live VM browser (scripted buyer, O7), settle, then hand
 * the main agent the unlocked URL. Anything else becomes a promise-status lookup.
 */
export async function* runPromiseAgent(ctx: SubCtx, task: string): AsyncGenerator<CEvent, string> {
  const { agent, deps } = ctx;
  let n = 0;
  const step = (label: string, state: "running" | "ok" | "error" = "running", detail?: string, ms?: number) =>
    ({ kind: "step", agent, id: `${agent}-s${++n}`, label, state, detail, ms }) satisfies CEvent;

  const article = matchArticle(task);
  if (!article) {
    // A paywall task that never named the story: hand back the premium slugs so the main agent can re-delegate precisely.
    if (/newsroom|article|story|paywall|premium/i.test(task)) {
      yield step("Which story?", "ok", "no slug in task", 0);
      const premium = ARTICLES.filter((a) => a.premium);
      return `Which premium Newsroom story should I unlock? ${premium.map((a) => `"${a.title}" (slug: ${a.slug})`).join("; ")}. Give me the slug and I will create the promise, approve it on the live browser and settle it.`;
    }
    yield step("Looking up promises", "running");
    const t0 = Date.now();
    const kws = tokens(task).filter((w) => w.length > 4 && !STOP.has(w)).slice(0, 6);
    const r = await deps.promise.find(kws);
    if (!r.ok) {
      yield step("Looking up promises", "error", r.reason, Date.now() - t0);
      return `I could not read the promise log: ${r.reason}`;
    }
    yield step("Looking up promises", "ok", `${r.data.length} match${r.data.length === 1 ? "" : "es"}`, Date.now() - t0);
    if (!r.data.length) return "No promises match that. Recent ones are listed on the home page and in the sidebar.";
    return `Promise status:\n${r.data.map((p) => `- ${fmtPromise(p)}`).join("\n")}`;
  }
  if (!article.premium) return `"${article.title}" is free — no promise needed. Open /api/newsroom/article?slug=${article.slug} (or the story link on /newsroom).`;

  // ---- the paywall unlock beat ----
  const base = deps.appUrl();
  if (isLocal(base)) {
    yield step("Checking reachability", "error", "app is not public", 0);
    return "I can only unlock paywalled articles when this app is reachable from the cloud browser and the condition fetcher — set PUBLIC_URL to the tunnel URL and ask again.";
  }

  const proofUrl = `${base}/api/newsroom/proof?article=${article.slug}`;
  yield step(`Creating a Standing Promise for "${article.title.slice(0, 60)}"`, "running");
  const tCreate = Date.now();
  const created = await deps.promise.create({
    title: `Unlock "${article.title}"`,
    amount: article.price,
    currency: article.currency,
    windowMinutes: 30,
    condition: { kind: "page_contains", url: proofUrl, needle: `unlocked:${article.slug}` },
  });
  if (!created.ok) {
    yield step("Creating a Standing Promise", "error", created.reason, Date.now() - tCreate);
    return `I could not create the promise: ${created.reason}`;
  }
  const pid = created.data.promiseId;
  yield step("Standing Promise created", "ok", pid.slice(0, 8), Date.now() - tCreate);

  const info0 = await deps.promise.info(pid);
  const orderId = info0.ok ? info0.data?.paypalOrderId : null;
  if (!orderId) {
    yield step("Reading the PayPal order", "error", "no order id on the promise", 0);
    return `The promise ${pid} exists but has no PayPal order yet — try settling or check /p?id=${pid}.`;
  }
  const approveUrl = approveUrlFor(orderId);
  yield { kind: "page", url: approveUrl, title: "PayPal — approve the sandbox order" };

  const vm = yield* ensureVm(ctx);
  if (!vm) {
    yield step("Starting the live browser", "error", "no VM", 0);
    return `Promise ${pid} was created but I could not start the cloud browser to approve it. Approve manually: ${approveUrl}`;
  }

  yield step("Approving the sandbox order on the live browser", "running");
  const tApprove = Date.now();
  const ap = await deps.approveOrder(vm, orderId);
  let buyerOk = ap.ok;
  if (!ap.ok) {
    // Scripted approval is best-effort (PayPal bot detection). The user can approve by hand on the
    // live browser they are watching — poll PayPal for ~75s before giving up.
    yield step("Waiting for manual approval on screen", "running", ap.reason.slice(0, 120));
    const tManual = Date.now();
    for (let i = 0; i < 30 && !buyerOk; i++) {
      if (ctx.signal?.aborted) return "Cancelled while waiting for approval.";
      await sleep(2500);
      const st = await deps.orderStatus(orderId);
      if (st.ok && st.data.status === "APPROVED") buyerOk = true;
    }
    if (!buyerOk) {
      yield step("Approving the sandbox order", "error", ap.reason, Date.now() - tApprove);
      return `The scripted approval failed (${ap.reason}). Approve manually on the live browser or at ${approveUrl} — tell me when done and I will settle.`;
    }
    yield step("Buyer approved on screen", "ok", "approved manually", Date.now() - tManual);
  } else {
    yield step("Buyer approved on screen", "ok", ap.data.finalUrl.slice(0, 80), Date.now() - tApprove);
  }

  yield step("Waiting for PayPal to confirm approval", "running");
  const tWait = Date.now();
  let approved = false;
  for (let i = 0; i < 20 && !approved; i++) {
    if (ctx.signal?.aborted) return "Cancelled while waiting for PayPal.";
    await sleep(2500);
    const st = await deps.orderStatus(orderId);
    if (st.ok && st.data.status === "APPROVED") approved = true;
  }
  if (!approved) {
    yield step("Waiting for PayPal", "error", "order not APPROVED in time", Date.now() - tWait);
    return `The buyer flow finished but PayPal still does not report the order APPROVED. Check /p?id=${pid} or approve manually at ${approveUrl}.`;
  }
  yield step("PayPal reports APPROVED", "ok", undefined, Date.now() - tWait);

  yield step("Settling the promise", "running");
  const tSettle = Date.now();
  const st = await deps.promise.settle(pid, ctx.signal);
  if (!st.ok) {
    yield step("Settling the promise", "error", st.reason, Date.now() - tSettle);
    return `Settlement failed: ${st.reason}. The order is approved; retry from /p?id=${pid}.`;
  }
  const after = await deps.promise.info(pid);
  const state = after.ok ? after.data?.state : undefined;
  yield step("Settled", state === "captured" ? "ok" : "error", state, Date.now() - tSettle);

  // The run log: what really happened, read back from PayPal. RivalPal measures its exam against this.
  const read = await deps.orderStatus(orderId);
  const log: PromiseRunLog = {
    promiseId: pid, approved: true, settled: st.ok, state: state ?? "unknown",
    orderStatusAfter: read.ok ? read.data.status : null, moneyOpsCarriedId: true, currency: article.currency, ...(ap.ok && typeof ap.data.steps === "number" ? { buyerSteps: ap.data.steps } : {}),
  };
  ctx.session.lastPromiseRun = log;
  yield step("Read the order back", read.ok ? "ok" : "error", read.ok ? read.data.status : read.reason, 0);

  if (state !== "captured") {
    return `The promise settled as "${state ?? "unknown"}" — the $${article.price} was ${state === "released" ? "released, not captured" : "not captured"}. The proof check may have run before PayPal propagated; try settling again from /p?id=${pid}.`;
  }
  const unlockUrl = `${base}/api/newsroom/article?slug=${article.slug}&token=${pid}`;
  return (
    `Unlocked "${article.title}" — Standing Promise ${pid} CAPTURED $${article.price} (order ${orderId}). ` +
    `The article now opens at ${unlockUrl} — send the browser agent there to read it, or give the user that link.`
  );
}
