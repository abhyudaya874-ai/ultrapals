import { safeHttpUrl } from "@/components/thread/safe-url";
import { avatarOf, hostOfUrl } from "@/lib/computer/visits";

/** A letter tile for a site. No favicon service and no remote image (D-UI): the same host always gets the same colour. */
export function SiteAvatar({ host, size = 16 }: { host: string; size?: number }) {
  const a = avatarOf(host);
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-medium text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.58), background: `hsl(${a.hue} 42% 38%)` }}>
      {a.letter}
    </span>
  );
}

/** A site as a dark chip: tile + host, linking to the page when it is a real http(s) URL. The title is the tooltip. */
export function SiteChip({ url, title, via }: { url: string; title?: string; via?: string }) {
  const href = safeHttpUrl(url);
  const host = hostOfUrl(url) || url;
  const body = (
    <>
      <SiteAvatar host={host} />
      <span className="truncate">{host}</span>
      {via && <span className="shrink-0 text-[11px] text-fg-dim">{via}</span>}
    </>
  );
  const cls = "inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-full border border-line bg-black/35 px-2.5 text-[12.5px] text-fg-muted";
  return href ? (
    <a href={href.href} target="_blank" rel="noreferrer noopener" title={title ?? url} className={`${cls} hover:bg-black/55 hover:text-fg`} data-testid="site-chip">{body}</a>
  ) : (
    <span title={title ?? url} className={cls} data-testid="site-chip">{body}</span>
  );
}

/** The stacked tiles beside "N sources": the first few distinct hosts, overlapping. */
export function SourceStack({ hosts, max = 4 }: { hosts: readonly string[]; max?: number }) {
  return (
    <span className="flex -space-x-1.5" aria-hidden>
      {hosts.slice(0, max).map((h) => (
        <span key={h} className="rounded-full ring-2 ring-surface"><SiteAvatar host={h} size={18} /></span>
      ))}
    </span>
  );
}
