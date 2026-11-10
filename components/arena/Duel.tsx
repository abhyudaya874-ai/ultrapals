"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { replay, type Frame, type Pose } from "@/lib/arena/replay";
import type { MatchResult } from "@/lib/arena/types";

export interface Contestant {
  id: string;
  name: string;
  tool: "research" | "browser" | "terminal";
}

const HOME: Pose = { x: 0, squash: 1, down: 0 };
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Steps through a match's frames with timers, one frame at a time. Starts from the orbs' home positions so the first move is visible; with
 * reduced motion it goes straight to the result. `again` plays it once more.
 */
export function useReplay(frames: readonly Frame[], autoplay: boolean) {
  const [at, setAt] = useState(-1);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!autoplay || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAt(frames.length - 1);
      return;
    }
    setAt(-1);
    let t: ReturnType<typeof setTimeout>;
    const step = (n: number) => {
      setAt(n);
      if (n < frames.length - 1) t = setTimeout(() => step(n + 1), frames[n].ms + frames[n].hold);
    };
    t = setTimeout(() => step(0), 40);
    return () => clearTimeout(t);
  }, [frames, autoplay, round]);
  return { at, frame: at >= 0 ? frames[at] : null, done: at >= frames.length - 1, again: () => setRound((r) => r + 1) };
}

/** Health as a hairline: the fill is the health now, and a fainter strip behind it catches up a moment later, so a hit is felt as well as seen. */
function Health({ hp, flip }: { hp: number; flip?: boolean }) {
  const pct = Math.max(0, Math.min(100, hp));
  const side = flip ? "right-0" : "left-0";
  return (
    <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span className={`absolute inset-y-0 ${side} bg-fg/25`} style={{ width: `${pct}%`, transition: `width 600ms ${EASE} 160ms` }} />
      <span className={`absolute inset-y-0 ${side} ${pct < 25 ? "bg-bad" : "bg-fg"}`} style={{ width: `${pct}%`, transition: `width 220ms ${EASE}, background-color 220ms` }} />
    </div>
  );
}

function Label({ who, hp, flip, won }: { who: Contestant; hp: number; flip?: boolean; won: boolean }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${flip ? "text-right" : ""}`}>
      <p className={`flex items-baseline gap-2 ${flip ? "flex-row-reverse" : ""}`}>
        <span className={`truncate text-[13px] ${won ? "font-medium text-fg" : "text-fg-muted"}`}>{who.name}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-fg-dim">{Math.round(hp)}</span>
      </p>
      <Health hp={hp} flip={flip} />
    </div>
  );
}

/**
 * A knockout match played back. The two orbs drift together, and for every hit that landed one lunges, touches and the other is flattened and
 * knocked back while its health drops. At the end the loser sinks (and fades if it was knocked out) and the winner stays forward.
 * Nothing else moves: no flashes, no numbers flying, just the orbs, a hairline ring where they touch and two health lines.
 */
export function Duel({ match, a, b, size = 64, autoplay = true }: { match: MatchResult; a: Contestant; b: Contestant; size?: number; autoplay?: boolean }) {
  const d = match.duel;
  const frames = useMemo(() => (d ? replay(d) : []), [d]);
  const { frame, done, again, at } = useReplay(frames, autoplay);
  if (!d || frames.length === 0) return null;
  const shown = frame ?? { kind: "intro", ms: 0, hold: 0, a: HOME, b: HOME, hp: d.from } satisfies Frame;
  const hitting = shown.kind === "hit" ? shown.hit : undefined;
  const pad = 24;
  // where the two orbs meet: the attacker's far edge, which is not the middle when one of them has pushed past it
  const contact = hitting ? (hitting.by === "a" ? `calc(${pad + size}px + var(--reach) * ${shown.a.x})` : `calc(100cqw - ${pad + size}px - var(--reach) * ${shown.b.x})`) : undefined;
  const track = { containerType: "inline-size", ["--reach" as string]: `calc(50cqw - ${pad + size}px)` } as CSSProperties;

  const orb = (who: Contestant, pose: Pose, side: "a" | "b") => {
    const dir = side === "a" ? 1 : -1;
    const hurt = hitting && hitting.by !== side;
    const style: CSSProperties = {
      width: size,
      height: size,
      [side === "a" ? "left" : "right"]: pad,
      transform: `translateX(calc(var(--reach) * ${(dir * pose.x).toFixed(3)})) translateY(${(pose.down * 6).toFixed(1)}px) scale(${pose.squash}, ${(1 + (1 - pose.squash) * 0.6).toFixed(3)})`,
      transition: `transform ${shown.ms}ms ${EASE}, opacity ${shown.ms}ms ${EASE}, filter ${shown.ms}ms ${EASE}`,
      opacity: (1 - pose.down * 0.55) * (hurt ? 0.8 : 1),
      filter: `grayscale(${pose.down})`,
    };
    return (
      <span className="absolute top-0" style={style}>
        <BattleOrb id={who.id} size={size} state="ok" tool={who.tool} winner={done && match.winner === who.id} />
      </span>
    );
  };

  return (
    <figure className="mx-auto w-full max-w-[560px]" data-testid="duel" data-frame={shown.kind}>
      <figcaption className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-fg-dim" style={{ paddingInline: pad }}>
        <span>{match.label}</span>
        {done && autoplay && <button type="button" onClick={again} className="press -mr-1.5 rounded px-1.5 py-0.5 normal-case tracking-normal text-fg-dim hover:text-fg">Replay</button>}
      </figcaption>
      <div style={track}>
        <div className="relative" style={{ height: size }}>
          {orb(a, shown.a, "a")}
          {orb(b, shown.b, "b")}
          {contact && <span key={at} className="duel-ring pointer-events-none absolute top-1/2 size-9 rounded-full border border-fg/40" style={{ left: contact }} aria-hidden />}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-6" style={{ paddingInline: pad }}>
          <Label who={a} hp={shown.hp.a} won={done && match.winner === a.id} />
          <Label who={b} hp={shown.hp.b} flip won={done && match.winner === b.id} />
        </div>
      </div>
      <p className="mt-3 min-h-5 text-center text-[13px] text-fg-muted" aria-live="polite">{done ? match.why?.headline : ""}</p>
    </figure>
  );
}
