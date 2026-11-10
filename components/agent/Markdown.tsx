import { Fragment } from "react";
import { parseInline, parseMarkdown } from "./markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.k === "b" ? <strong key={i} className="font-semibold text-fg">{p.text}</strong>
        : p.k === "code" ? <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em]">{p.text}</code>
        : p.k === "a" ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{p.text}</a>
        : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

/** Renders the markdown subset in markdown.ts as React elements. Never uses innerHTML, so file contents cannot inject markup. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-fg" data-testid="markdown">
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case "h": return b.level === 1 ? <h1 key={i} className="font-serif text-[24px] leading-tight text-fg"><Inline text={b.text} /></h1>
            : b.level === 2 ? <h2 key={i} className="pt-2 font-serif text-[19px] leading-snug text-fg"><Inline text={b.text} /></h2>
            : <h3 key={i} className="pt-1 text-[14.5px] font-semibold text-fg"><Inline text={b.text} /></h3>;
          case "p": return <p key={i} className="whitespace-pre-line"><Inline text={b.text} /></p>;
          case "ul": return <ul key={i} className="list-disc space-y-1 pl-6 marker:text-fg-dim">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
          case "ol": return <ol key={i} className="list-decimal space-y-1 pl-6 marker:text-fg-dim">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
          case "quote": return <blockquote key={i} className="border-l-2 border-line pl-3 text-fg-muted"><Inline text={b.text} /></blockquote>;
          case "hr": return <hr key={i} className="border-line" />;
          case "code": return <pre key={i} className="overflow-x-auto rounded-lg border border-line bg-canvas/60 p-3 font-mono text-[12px] leading-relaxed text-fg-muted">{b.text}</pre>;
          case "table": return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead><tr>{b.head.map((c, j) => <th key={j} className="border border-line bg-surface-2 px-2 py-1 text-left font-medium text-fg"><Inline text={c} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-line px-2 py-1 align-top text-fg-muted"><Inline text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
      })}
    </div>
  );
}
