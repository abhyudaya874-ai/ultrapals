"use client";
import { HoverCard } from "@/components/ui/HoverCard";
import type { Source } from "@/lib/research/sources";
import { CiteCard } from "./CiteCard";

/** An inline citation: the site's name as a small chip; hover for the passage found, click to open the source. */
export function Cite({ ns, sources, onOpen }: { ns: number[]; sources: Source[]; onOpen: (n: number) => void }) {
  const first = sources[ns[0] - 1];
  return (
    <HoverCard card={<CiteCard ns={ns} sources={sources} />} className="inline-block align-middle">
      <button type="button" data-testid="cite" onClick={() => onOpen(ns[0])}
        className="press mx-0.5 inline-flex h-[18px] max-w-[9rem] translate-y-[-1px] items-center gap-1 truncate rounded-full bg-surface-2 px-1.5 align-middle font-sans text-[11px] text-fg-muted hover:bg-line hover:text-fg">
        <span className="truncate">{first?.host ?? ns[0]}</span>
        {ns.length > 1 && <span className="text-fg-dim">+{ns.length - 1}</span>}
      </button>
    </HoverCard>
  );
}
