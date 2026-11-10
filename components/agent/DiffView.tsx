"use client";
import { useEffect, useState } from "react";
import type { DiffLine } from "@/lib/computer/diff";

const ROW: Record<DiffLine["op"], string> = {
  add: "bg-ok/15 text-fg",
  del: "bg-bad/15 text-fg",
  ctx: "text-fg-muted",
  gap: "bg-surface-2/60 text-fg-dim",
};
const GUTTER: Record<DiffLine["op"], string> = { add: "text-ok", del: "text-bad", ctx: "text-fg-dim", gap: "" };
const SIGN: Record<DiffLine["op"], string> = { add: "+", del: "−", ctx: "", gap: "" };
const BAR: Record<DiffLine["op"], string> = { add: "border-ok", del: "border-bad", ctx: "border-transparent", gap: "border-transparent" };

/**
 * A unified diff: added lines green with a "+", removed lines red with a "−", unchanged context dim, long unchanged stretches folded.
 * With `tone="read"` the same rows show a file that was only read: numbered lines with an accent bar, nothing red or green.
 */
/** Pure. How many rows to add per tick so even a 400-row diff finishes streaming in about two seconds. */
export const revealStep = (total: number): number => (total <= 40 ? 1 : Math.ceil(total / 70));

/** Rows that appear one after another (like a file being typed out) instead of all at once. `on=false` shows everything immediately. */
function useReveal(total: number, on: boolean): number {
  const [n, setN] = useState(on ? 0 : total);
  useEffect(() => {
    if (!on) { setN(total); return; }
    if (n >= total) return;
    const t = setTimeout(() => setN((x) => Math.min(total, x + revealStep(total))), 26);
    return () => clearTimeout(t);
  }, [on, n, total]);
  return on ? n : total;
}

export function DiffView({ lines, cut = 0, max, tone = "diff", testId, animate = false }: { lines: DiffLine[]; cut?: number; max?: number; tone?: "diff" | "read"; testId?: string; animate?: boolean }) {
  const all = max ? lines.slice(0, max) : lines;
  const count = useReveal(all.length, animate);
  const shown = all.slice(0, count);
  const hidden = animate && count < all.length ? 0 : lines.length - all.length + cut;
  const both = shown.some((l) => l.a !== undefined) && shown.some((l) => l.b !== undefined);
  return (
    <div data-testid={testId ?? "diff"} className="overflow-x-auto rounded-lg border border-line bg-canvas/60 py-1 font-mono text-[12px] leading-[1.55]" role="table" aria-label={tone === "read" ? "Lines read" : "Changes"}>
      {shown.map((l, i) =>
        l.op === "gap" ? (
          <div key={i} role="row" className={`${animate ? "rise " : ""}px-3 py-0.5 text-center text-[11.5px] italic ${ROW.gap}`}>⋯ {l.text}</div>
        ) : (
          <div key={i} role="row" data-op={l.op} className={`${animate ? "rise " : ""}flex min-w-full w-max border-l-2 ${tone === "read" ? "border-accent/60 text-fg-muted" : `${ROW[l.op]} ${BAR[l.op]}`}`}>
            {both && <span className={`w-9 shrink-0 select-none pr-2 text-right tabular-nums ${GUTTER[l.op]}`}>{l.a ?? ""}</span>}
            <span className={`w-9 shrink-0 select-none pr-2 text-right tabular-nums ${tone === "read" ? "text-fg-dim" : GUTTER[l.op]}`}>{l.b ?? (both ? "" : l.a ?? "")}</span>
            <span className={`w-4 shrink-0 select-none text-center ${tone === "read" ? "" : GUTTER[l.op]}`} aria-label={l.op === "add" ? "added" : l.op === "del" ? "removed" : undefined}>{tone === "read" ? "" : SIGN[l.op]}</span>
            <span className="whitespace-pre pr-3">{l.text || " "}</span>
          </div>
        ),
      )}
      {hidden > 0 && <div className="px-3 py-0.5 text-center text-[11.5px] italic text-fg-dim">⋯ {hidden} more line{hidden === 1 ? "" : "s"} not shown</div>}
      {all.length === 0 && <div className="px-3 py-1 text-fg-dim">{tone === "read" ? "The file is empty." : "No changes."}</div>}
    </div>
  );
}
