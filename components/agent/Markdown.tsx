"use client";
import { Fragment } from "react";
import { segmentCitations } from "@/lib/research/citations";
import type { Source } from "@/lib/research/sources";
import { Cite } from "./Cite";
import { numericColumn, parseInline, parseMarkdown, type Align, type MdBlock } from "./markdown";

interface Cites {
  sources: Source[];
  onOpen: (n: number) => void;
}

/** Text with `[n]` markers: the markers become citation chips when the answer has sources, otherwise they stay as written. */
function Words({ text, cites }: { text: string; cites?: Cites }) {
  if (!cites || cites.sources.length === 0) return <>{text}</>;
  return (
    <>
      {segmentCitations(text, cites.sources.length).map((s, i) => (s.kind === "cite" ? <Cite key={i} ns={s.ns} sources={cites.sources} onOpen={cites.onOpen} /> : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}

/** One line of markdown: bold, italic, strike, code and web links, with citation chips inside everything but code. Never uses innerHTML. */
function Inline({ text, cites }: { text: string; cites?: Cites }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.k === "b" ? <strong key={i} className="font-semibold text-fg"><Words text={p.text} cites={cites} /></strong>
        : p.k === "i" ? <em key={i}><Words text={p.text} cites={cites} /></em>
        : p.k === "s" ? <del key={i} className="text-fg-dim"><Words text={p.text} cites={cites} /></del>
        : p.k === "code" ? <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em]">{p.text}</code>
        : p.k === "a" ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{p.text}</a>
        : <Words key={i} text={p.text} cites={cites} />,
      )}
    </>
  );
}

const ALIGN: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };

function Table({ b, cites }: { b: Extract<MdBlock, { t: "table" }>; cites?: Cites }) {
  // a column of numbers lines up on its right edge even when the author did not say so
  const align = b.align.map((a, k) => (a === "left" && numericColumn(b.rows, k) ? "right" : a));
  return (
    <div className="overflow-x-auto rounded-xl border border-line" data-testid="md-table">
      <table className="w-full border-collapse font-sans text-[13.5px] leading-snug">
        <thead>
          <tr className="bg-surface-2/60">
            {b.head.map((c, k) => <th key={k} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium text-fg ${ALIGN[align[k]]}`}><Inline text={c} cites={cites} /></th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {b.rows.map((r, j) => (
            <tr key={j} className="transition-colors hover:bg-surface-2/30">
              {r.map((c, k) => (
                <td key={k} className={`px-3 py-2 align-top ${ALIGN[align[k]]} ${align[k] === "right" ? "tabular-nums" : ""} ${k === 0 ? "font-medium text-fg" : "text-fg-muted"}`}>
                  {c.split("\n").map((line, l) => <Fragment key={l}>{l > 0 && <br />}<Inline text={line} cites={cites} /></Fragment>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Blocks({ blocks, cites, serif }: { blocks: MdBlock[]; cites?: Cites; serif: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": return b.level === 1 ? <h1 key={i} className="pt-1 font-serif text-[24px] leading-tight text-fg"><Inline text={b.text} cites={cites} /></h1>
            : b.level === 2 ? <h2 key={i} className="pt-2 font-serif text-[20px] leading-snug text-fg"><Inline text={b.text} cites={cites} /></h2>
            : <h3 key={i} className={`pt-1 font-semibold text-fg ${serif ? "text-[17.5px]" : "text-[14.5px]"}`}><Inline text={b.text} cites={cites} /></h3>;
          case "p": return <p key={i}>{b.text.split("\n").map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} cites={cites} /></Fragment>)}</p>;
          case "ul":
          case "ol": {
            const Tag = b.t;
            return (
              <Tag key={i} {...(b.t === "ol" && b.start !== 1 ? { start: b.start } : {})} className={`space-y-1.5 pl-6 marker:text-fg-dim ${b.t === "ul" ? "list-disc" : "list-decimal"}`}>
                {b.items.map((it, j) => (
                  <li key={j} className="pl-0.5">
                    <Inline text={it.text} cites={cites} />
                    {it.sub && <div className="mt-1.5 space-y-1.5"><Blocks blocks={it.sub} cites={cites} serif={serif} /></div>}
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote": return <blockquote key={i} className="border-l-2 border-line pl-3 text-fg-muted">{b.text.split("\n").map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} cites={cites} /></Fragment>)}</blockquote>;
          case "hr": return <hr key={i} className="border-line" />;
          case "code": return (
            <pre key={i} className="overflow-x-auto rounded-lg border border-line bg-canvas/60 p-3 font-mono text-[12px] leading-relaxed text-fg-muted">
              {b.lang && <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-fg-dim">{b.lang}</span>}
              {b.text}
            </pre>
          );
          case "table": return <Table key={i} b={b} cites={cites} />;
        }
      })}
    </>
  );
}

/**
 * Renders the markdown subset in markdown.ts as React elements: headings, lists (nested), tables (aligned, numbers on the right), quotes, code, bold, italic, strike
 * and links. Never uses innerHTML, so file contents and model output cannot inject markup. With `sources`, `[n]` markers become citation chips, in tables and lists too.
 * `serif` is the look of an answer in the thread; without it, this is a document.
 */
export function Markdown({ text, sources, onOpen, serif = false }: { text: string; sources?: Source[]; onOpen?: (n: number) => void; serif?: boolean }) {
  const cites = sources && onOpen ? { sources, onOpen } : undefined;
  return (
    <div data-testid={serif ? "answer" : "markdown"} className={serif ? "space-y-3.5 font-serif text-[17px] leading-[1.65] text-fg" : "space-y-3 text-[14px] leading-relaxed text-fg"}>
      <Blocks blocks={parseMarkdown(text)} cites={cites} serif={serif} />
    </div>
  );
}
