"use client";
import { safeHttpUrl } from "@/components/thread/safe-url";
import { SiteAvatar } from "@/components/ui/SiteChip";
import type { Source } from "@/lib/research/sources";
import { excerpt } from "./excerpt";

/** What a citation points at: the page's site and title, the passage the agent found, and a link to open it. */
export function CiteCard({ ns, sources }: { ns: number[]; sources: readonly Source[] }) {
  const list = ns.map((n) => sources[n - 1]).filter((s): s is Source => !!s);
  if (list.length === 0) return <p className="text-[12.5px] text-fg-dim">This source is not in the list.</p>;
  return (
    <ul className="space-y-3" data-testid="cite-card">
      {list.map((s) => {
        const href = safeHttpUrl(s.url);
        return (
          <li key={s.n} className="space-y-1.5">
            <p className="flex items-center gap-2 text-[12px] text-fg-dim"><SiteAvatar host={s.host} size={16} /><span className="truncate">{s.host}</span>{s.publishedDate && <span className="shrink-0">· {s.publishedDate.slice(0, 10)}</span>}</p>
            <p className="text-[13.5px] font-medium leading-snug text-fg">{s.title}</p>
            {s.snippet && <p className="text-[12.5px] leading-relaxed text-fg-muted">{excerpt(s.snippet)}</p>}
            {href && <a href={href.href} target="_blank" rel="noreferrer noopener" className="press inline-block text-[12.5px] text-accent hover:underline">Open the page</a>}
          </li>
        );
      })}
    </ul>
  );
}
