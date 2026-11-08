"use client";
import { IconX } from "@/components/ui/icons";
import { safeHttpUrl } from "@/components/thread/safe-url";
import type { Source } from "@/lib/research/sources";

function Card({ s, active, onPick }: { s: Source; active: boolean; onPick: (n: number) => void }) {
  const href = safeHttpUrl(s.url);
  return (
    <li className={`rounded-card p-3 ${active ? "bg-surface-2" : ""}`} data-testid="source-card">
      <button type="button" onClick={() => onPick(s.n)} className="flex w-full items-center gap-2 text-left text-[12px] text-fg-dim">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-surface-2 text-[11px] text-fg-muted">{s.n}</span>
        <span className="truncate">{s.host}</span>
        <span className="ml-auto shrink-0">{s.provider}{s.publishedDate ? ` · ${s.publishedDate.slice(0, 10)}` : ""}</span>
      </button>
      <h3 className="mt-1.5 text-[14px] font-medium leading-snug text-fg">
        {href ? <a href={href.href} target="_blank" rel="noreferrer noopener" className="hover:underline">{s.title}</a> : s.title}
      </h3>
      <p className={`mt-1 text-[13px] leading-relaxed text-fg-muted ${active ? "" : "line-clamp-3"}`}>{s.snippet}</p>
    </li>
  );
}

/** Right pane: every source of a turn, the clicked one expanded and highlighted. Esc/outside-click close via the parent. */
export function SourcePane({ sources, active, onPick, onClose }: { sources: Source[]; active: number | null; onPick: (n: number) => void; onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-card border border-line bg-surface" data-testid="pane">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-medium text-fg">{sources.length} sources</h2>
        <button type="button" onClick={onClose} aria-label="Close pane" title="Close pane" className="ml-auto grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <IconX className="size-4" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {sources.map((s) => <Card key={s.n} s={s} active={s.n === active} onPick={onPick} />)}
      </ul>
    </div>
  );
}
