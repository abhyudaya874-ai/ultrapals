"use client";
import { Fragment } from "react";
import { segmentCitations } from "@/lib/research/citations";
import type { Source } from "@/lib/research/sources";

/** **bold** and `code` only: model answers are short and the sources are the point. No raw HTML ever reaches the DOM. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong>
        : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em]">{p.slice(1, -1)}</code>
        : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

function Cite({ ns, sources, onOpen }: { ns: number[]; sources: Source[]; onOpen: (n: number) => void }) {
  const first = sources[ns[0] - 1];
  return (
    <button type="button" data-testid="cite" onClick={() => onOpen(ns[0])} title={ns.map((n) => sources[n - 1]?.title).filter(Boolean).join(" · ")}
      className="mx-0.5 inline-flex h-[18px] max-w-[9rem] translate-y-[-1px] items-center gap-1 truncate rounded-full bg-surface-2 px-1.5 align-middle font-sans text-[11px] text-fg-muted transition-colors hover:bg-line hover:text-fg">
      <span className="truncate">{first?.host ?? ns[0]}</span>
      {ns.length > 1 && <span className="text-fg-dim">+{ns.length - 1}</span>}
    </button>
  );
}

function Line({ text, sources, onOpen }: { text: string; sources: Source[]; onOpen: (n: number) => void }) {
  return (
    <>
      {segmentCitations(text, sources.length).map((s, i) =>
        s.kind === "cite" ? <Cite key={i} ns={s.ns} sources={sources} onOpen={onOpen} /> : <Inline key={i} text={s.text} />,
      )}
    </>
  );
}

/** Serif answer with inline citation chips. Blocks are split on blank lines; "- " and "1. " lines become list items. */
export function AnswerText({ text, sources, onOpen }: { text: string; sources: Source[]; onOpen: (n: number) => void }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div data-testid="answer" className="space-y-3 font-serif text-[17px] leading-[1.65] text-fg">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        const bullet = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        return bullet ? (
          <ul key={i} className="list-disc space-y-1 pl-6 marker:text-fg-dim">
            {lines.map((l, j) => <li key={j}><Line text={l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")} sources={sources} onOpen={onOpen} /></li>)}
          </ul>
        ) : (
          <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Line text={l} sources={sources} onOpen={onOpen} /></Fragment>)}</p>
        );
      })}
    </div>
  );
}
