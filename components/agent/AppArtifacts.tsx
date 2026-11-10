"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ProctorPanel } from "@/components/ProctorPanel";
import { useAgent } from "./AgentProvider";

// Studio and Bryntum touch `window`: browser only.
const StudioBoard = dynamic(() => import("@/components/studio/StudioBoard").then((m) => m.StudioBoard), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-card bg-surface-2" /> });
const PromiseTimeline = dynamic(() => import("@/components/PromiseTimeline"), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-card bg-surface-2" /> });

interface Article {
  slug: string;
  title: string;
  dek: string;
  premium: boolean;
  price: string;
  published: string;
}

const BTN = "h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

/** The Newsroom as an artifact. The buttons hand a task to UltraPal; the paywall itself is still unlocked only by PromisePal. */
export function NewsroomArtifact() {
  const { send, busy } = useAgent();
  const [items, setItems] = useState<Article[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/newsroom/articles")
      .then((r) => (r.ok ? r.json() : { articles: [] }))
      .then((d: { articles?: Article[] }) => live && setItems(d.articles ?? []))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, []);
  if (!items) return <div className="m-3 h-40 animate-pulse rounded-card bg-surface-2" />;
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="newsroom-artifact">
      <h2 className="font-serif text-[22px] text-fg">The Newsroom</h2>
      <p className="mt-1 text-[13px] text-fg-muted">Free stories open. Premium ones cost $0.01 and are paid through a Standing Promise only if the article proves readable.</p>
      <ol className="mt-4 space-y-3">
        {items.map((a) => (
          <li key={a.slug} className="rounded-card bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-serif text-[17px] leading-snug text-fg">{a.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{a.dek}</p>
              </div>
              <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[11.5px] ${a.premium ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"}`}>{a.premium ? `PREMIUM · $${a.price}` : "FREE"}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={BTN} onClick={() => void send(a.premium ? `Unlock the premium Newsroom story "${a.slug}" with PromisePal, then summarise it in five bullet points.` : `Read the Newsroom story "${a.slug}" and summarise it in five bullet points.`)}>
                {a.premium ? "Unlock and summarise" : "Summarise"}
              </button>
              <button type="button" disabled={busy} className={BTN} onClick={() => void send(`Open the Newsroom artifact data and tell me which stories are premium and what they cost.`)}>
                Ask UltraPal about the catalog
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DashboardArtifact() {
  return (
    <div className="h-full overflow-auto p-3" data-testid="dashboard-artifact">
      <div className="h-full min-h-[560px]"><StudioBoard /></div>
    </div>
  );
}

export function TimelineArtifact() {
  return (
    <div className="h-full overflow-auto p-3" data-testid="timeline-artifact">
      <div className="h-full min-h-[360px]"><PromiseTimeline /></div>
    </div>
  );
}

export function ProctorArtifact() {
  return (
    <div className="h-full overflow-y-auto p-3" data-testid="proctor-artifact">
      <ProctorPanel />
    </div>
  );
}
