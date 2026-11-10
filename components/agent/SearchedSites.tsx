"use client";
import { Disclosure } from "@/components/ui/Disclosure";
import { IconSearch } from "@/components/ui/icons";
import { SiteChip } from "@/components/ui/SiteChip";
import { groupVisits, type Visit } from "@/lib/computer/visits";

const ENGINE: Record<string, string> = { tavily: "Tavily", exa: "Exa", fetch: "read directly", browser: "browser", terminal: "terminal" };

/** Perplexity-style: every query that was searched and every site that was read, as it happens. Collapsed into one row. */
export function SearchedSites({ visits, running }: { visits: readonly Visit[]; running: boolean }) {
  const g = groupVisits(visits);
  if (g.searches.length === 0 && g.pages === 0) return null;
  const label = `${g.searches.length > 0 ? "Searched the web" : "Read websites"}${g.pages > 0 && g.searches.length > 0 ? `, read ${g.pages} website${g.pages === 1 ? "" : "s"}` : ""}`;
  return (
    <li className="rise list-none" data-testid="searched-sites">
      <Disclosure key={String(running)} defaultOpen={running} label={label} meta={`${g.searches.length} search${g.searches.length === 1 ? "" : "es"} · ${g.hosts.length} site${g.hosts.length === 1 ? "" : "s"}`}>
        <ul className="ml-1 space-y-1 border-l border-line pl-3.5">
          {g.searches.map((s) => (
            <li key={s.id} className="rise flex items-center gap-2 text-[13px] text-fg-muted">
              <IconSearch className="size-3.5 shrink-0" />
              <span className="truncate">{s.label}</span>
              <span className="shrink-0 text-[11.5px] text-fg-dim">{s.via ? ENGINE[s.via] : ""}{s.count !== undefined ? ` · ${s.count} results` : ""}</span>
            </li>
          ))}
          {g.hosts.map((h) => (
            <li key={h.host} className="rise space-y-1 pt-1">
              <p className="text-[12.5px] text-fg-dim">Reading: {h.host}</p>
              <div className="flex flex-wrap gap-1.5">
                {h.pages.map((p) => <SiteChip key={p.id} url={p.url!} title={p.title} via={p.via ? ENGINE[p.via] : undefined} />)}
              </div>
            </li>
          ))}
        </ul>
      </Disclosure>
    </li>
  );
}
