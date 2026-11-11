"use client";
import { useRef } from "react";
import { useStickToBottom } from "@/components/thread/Dock";
import { NEAR_END_SMALL } from "@/components/thread/stick";

/**
 * Text that grows at the end (a model's thinking, a command's output). It follows the newest words while you are at the end of it, stops
 * following the moment you scroll up to read something, and follows again as soon as you scroll back to the end.
 */
function Following({ text, className, testId }: { text: string; className: string; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(box, text.length, NEAR_END_SMALL);
  return (
    <div ref={box} onScroll={stick.onScroll} data-testid={testId} data-following={!stick.away} className={`overflow-y-auto whitespace-pre-wrap ${className}`}>{text}</div>
  );
}

/** A model's thinking, as it streams. */
export function Thought({ text, className = "", testId }: { text: string; className?: string; testId?: string }) {
  return <Following text={text} testId={testId} className={`italic leading-relaxed text-fg-dim ${className}`} />;
}

/** A command's output, as it arrives. */
export function Tail({ text, className = "", testId }: { text: string; className?: string; testId?: string }) {
  return <Following text={text} testId={testId} className={`break-all font-mono text-fg-muted ${className}`} />;
}
