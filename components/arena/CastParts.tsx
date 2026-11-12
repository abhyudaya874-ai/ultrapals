"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Draws a figure of a fixed size (`width` by `height`, in the units its layout was worked out in) and shrinks it to fit when the room is narrower
 * than that, as on a phone. It reserves `reserve` px of height (scaled the same way) whatever the figure's own height is, with the figure standing
 * on the bottom, so a taller or shorter figure does not move what is below it.
 */
export function Fit({ width, height, reserve, children }: { width: number; height: number; reserve: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(width);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setRoom(el.clientWidth);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const scale = room > 0 ? Math.min(1, room / width) : 1;
  return (
    <div ref={box} className="flex w-full min-w-0 items-end" style={{ height: Math.max(reserve, height) * scale }}>
      <div className="shrink-0" style={{ width, height, transform: scale < 1 ? `scale(${scale.toFixed(4)})` : undefined, transformOrigin: "left bottom" }}>{children}</div>
    </div>
  );
}

/**
 * The line under a preview: what is happening now, and on the right, once it has played through, a way to play it again. The words are for people who can see it, so they are hidden from screen readers (the figure has its own description) and are not announced
 * every beat. With reduced motion nothing plays, so there is nothing to replay.
 */
export function CastCaption({ text, done, still, onReplay }: { text: string; done: boolean; still: boolean; onReplay: () => void }) {
  return (
    <figcaption className="mt-1 flex h-5 items-center gap-3 text-[12px] text-fg-dim">
      <span className="min-w-0 truncate" title={text} aria-hidden>{text}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {done && !still && <button type="button" onClick={onReplay} className="press rounded px-1.5 py-0.5 text-fg-dim hover:text-fg">Replay</button>}
      </span>
    </figcaption>
  );
}
