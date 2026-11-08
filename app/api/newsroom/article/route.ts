import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { promise } from "@/db/schema";
import { articleBySlug, paywallOffer, type NewsArticle } from "@/lib/newsroom";
import { isUnlockedFor } from "@/lib/newsroom-access";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHELL = (inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Newsroom</title>
<style>body{margin:0;background:#15171b;color:#dbdee3;font:16px/1.7 Georgia,serif}.wrap{max-width:680px;margin:0 auto;padding:48px 24px}h1{font-size:30px;line-height:1.25;margin:0 0 8px}h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#8b93a1;margin:0 0 24px}.dek{color:#aab1bd;font-size:18px;margin:0 0 28px}.meta{color:#6b7280;font-size:13px;margin-bottom:36px}p{margin:0 0 20px}.pay{border:1px solid #2a2e36;border-radius:14px;padding:28px;margin-top:12px}.pay h3{font-family:system-ui,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5eead4;margin:0 0 10px}.pay p{font-family:system-ui,sans-serif;font-size:14px;color:#aab1bd;line-height:1.6}.price{font-family:system-ui,sans-serif;font-size:26px;color:#dbdee3;margin:14px 0}.cta{display:inline-block;margin-top:8px;padding:10px 18px;border-radius:999px;background:#0f3d3a;color:#5eead4;font-family:system-ui,sans-serif;font-size:14px;text-decoration:none}.back{color:#8b93a1;font-family:system-ui,sans-serif;font-size:13px}</style></head><body><div class="wrap">${inner}</div></body></html>`;

function articleHtml(a: NewsArticle): string {
  return SHELL(
    `<h2>The Newsroom</h2><h1>${esc(a.title)}</h1><p class="dek">${esc(a.dek)}</p><p class="meta">${a.premium ? `<span style="color:#5eead4">PREMIUM · $${esc(a.price)}</span> · ` : ""}${a.published}</p>` +
      a.body.map((p) => `<p>${esc(p)}</p>`).join("") +
      `<p class="meta" style="margin-top:36px"><a class="back" href="/newsroom">← All stories</a></p>`,
  );
}

function paywallHtml(a: NewsArticle): string {
  return SHELL(
    `<h2>The Newsroom</h2><h1>${esc(a.title)}</h1><p class="dek">${esc(a.dek)}</p>` +
      `<div class="pay"><h3>Premium story · $${esc(a.price)}</h3>` +
      `<p>This article is metered. An agent can unlock it with a <strong>Standing Promise</strong>: $${esc(a.price)} is captured <em>only if</em> the article proves readable — otherwise the payment is released, not taken.</p>` +
      `<p class="price">$${esc(a.price)} <span style="font-size:14px;color:#6b7280">USD · one time</span></p>` +
      `<a class="cta" href="/newsroom">Ask the agent to unlock it</a>` +
      `<p style="margin-top:14px">Programmatic clients receive HTTP 402 with the payment offer. Add <code>?format=json</code> for the machine-readable version.</p></div>` +
      `<p class="meta" style="margin-top:28px"><a class="back" href="/newsroom">← All stories</a></p>`,
  );
}

const wantsJson = (req: Request) => new URL(req.url).searchParams.get("format") === "json" || (req.headers.get("accept") ?? "").includes("application/json");

/** CrawlerPal-style: free content is open; premium returns HTTP 402 until a CAPTURED promise proves it. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const a = articleBySlug(slug);
  if (!a) return Response.json({ error: "unknown article" }, { status: 404 });
  if (!a.premium) return new Response(articleHtml(a), { headers: { "content-type": "text/html; charset=utf-8" } });

  const token = new URL(req.url).searchParams.get("token");
  if (token) {
    const [row] = await getDb()
      .select({ state: promise.state, condition: promise.condition })
      .from(promise)
      .where(eq(promise.id, token))
      .limit(1);
    if (isUnlockedFor(row as Parameters<typeof isUnlockedFor>[0], slug)) {
      return new Response(articleHtml(a), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }

  if (wantsJson(req)) return Response.json(paywallOffer(a), { status: 402 });
  return new Response(paywallHtml(a), { status: 402, headers: { "content-type": "text/html; charset=utf-8" } });
}
