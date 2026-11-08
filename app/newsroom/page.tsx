import Link from "next/link";
import { ARTICLES } from "@/lib/newsroom";

export const dynamic = "force-dynamic";

/** The demo publisher: free stories open, premium ones sit behind a real HTTP 402 Standing Promise paywall. */
export default function NewsroomPage() {
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-6 py-10">
        <header className="mb-8">
          <h1 className="font-serif text-[34px] leading-tight text-fg">The Newsroom</h1>
          <p className="mt-1 text-[14px] text-fg-muted">Agentic commerce, reported. Premium stories are metered at $0.01 through a Standing Promise — paid only if the article proves readable.</p>
        </header>
        <ol className="space-y-3" data-testid="newsroom-list">
          {ARTICLES.map((a) => (
            <li key={a.slug} className="rounded-card bg-surface p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-serif text-[19px] leading-snug text-fg">
                    <Link href={`/api/newsroom/article?slug=${a.slug}`} className="hover:underline">{a.title}</Link>
                  </h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-fg-muted">{a.dek}</p>
                </div>
                <span className={`mt-1 shrink-0 rounded-full px-2.5 py-1 text-[11.5px] ${a.premium ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"}`}>
                  {a.premium ? `PREMIUM · $${a.price}` : "FREE"}
                </span>
              </div>
              {a.premium && (
                <p className="mt-3 text-[12.5px] text-fg-dim">
                  Ask the Computer agent: <em>“unlock the premium story about {a.slug.replace(/-/g, " ")}”</em> — it creates a promise, approves the sandbox order on the live browser, settles, and opens the article.
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-8 text-[12.5px] text-fg-dim">
          Machine clients: <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">GET /api/newsroom/article?slug=&lt;slug&gt;&amp;format=json</code> returns HTTP 402 with the payment offer.
        </p>
      </div>
    </main>
  );
}
