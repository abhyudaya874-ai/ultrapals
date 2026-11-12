"use client";
import { useCallback, useEffect, useState } from "react";

export interface Played<T> {
  /** Index of the beat on show. */
  at: number;
  beat: T;
  /** The last cycle has finished and the last beat is staying on screen. */
  done: boolean;
  /** Which time through it is (0-based). */
  cycle: number;
  /** Nothing moves: the person asked for reduced motion (or it is switched off), so the last beat is simply shown. */
  still: boolean;
  /** Play it from the top again. */
  replay: () => void;
}

interface Where<T> {
  tape: readonly T[];
  at: number;
  cycle: number;
}

/**
 * Plays a list of timed beats in order, one timer per beat (the same way the real Duel steps through its frames), `cycles` times through, then stays on
 * the last beat. A beat's `ms` is how long the move into it takes (the screen transitions over that time) and `hold` how long it then stays. With
 * reduced motion, or when `enabled` is false, it goes straight to the last beat and does not move. A different tape (another count) starts from the top.
 */
export function useTape<T extends { ms: number; hold: number }>(tape: readonly T[], opts: { cycles?: number; enabled?: boolean } = {}): Played<T> {
  const cycles = opts.cycles ?? 2;
  const enabled = opts.enabled ?? true;
  const last = tape.length - 1;
  const [pos, setPos] = useState<Where<T>>({ tape, at: 0, cycle: 0 });
  const [still, setStill] = useState(false);
  const [round, setRound] = useState(0);
  const replay = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      setPos({ tape, at: last, cycle: cycles - 1 });
      return;
    }
    setStill(false);
    let timer: ReturnType<typeof setTimeout>;
    const play = (i: number, c: number) => {
      setPos({ tape, at: i, cycle: c });
      const b = tape[i];
      timer = setTimeout(() => {
        if (i < last) play(i + 1, c);
        else if (c < cycles - 1) play(0, c + 1);
        // otherwise: the last beat of the last cycle stays
      }, b.ms + b.hold);
    };
    play(0, 0);
    return () => clearTimeout(timer);
  }, [tape, last, cycles, enabled, round]);

  // until the effect has started the new tape, show its first beat rather than the old position
  const here: Where<T> = pos.tape === tape ? pos : { tape, at: 0, cycle: 0 };
  const i = Math.min(here.at, last);
  return { at: i, beat: tape[i], done: i >= last && here.cycle >= cycles - 1, cycle: here.cycle, still, replay };
}
