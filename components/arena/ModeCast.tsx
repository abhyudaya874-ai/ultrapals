"use client";
import { useState } from "react";
import { UltraOrb } from "@/components/orbs/Orbs";
import type { UltraState } from "@/components/orbs/mood";
import { useLast, usePresent } from "@/components/ui/presence";
import type { ArenaMode } from "@/lib/arena/mode";
import { BattleCast } from "./BattleCast";
import { LoopCast } from "./LoopCast";

/** A little longer than the 160ms the box takes to close (`.snap-grow`), so the preview is still drawn while it folds away. */
const LEAVE_MS = 300;

/**
 * The picture at the top of the empty home screen. UltraPal stays where it always was (the same orb at the same size, so it is never rebuilt). When the
 * mode is Battle or Loop, a preview of that mode opens beside it, with one orb for each team or round that is picked: Battle shows its teams
 * and a short knockout, Loop shows its rounds taking their turns. Switch back to chat and it folds away. While the preview plays UltraPal
 * looks busy, and when it has played through UltraPal settles.
 */
export function ModeCast({ mode, state }: { mode: ArenaMode; state: UltraState }) {
  const arena = mode.kind !== "chat";
  const present = usePresent(arena, LEAVE_MS);
  // while it folds away the preview keeps drawing the mode it had
  const kind = useLast(arena ? mode.kind : null, LEAVE_MS);
  const count = useLast(arena ? mode.n : null, LEAVE_MS);
  const [playing, setPlaying] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:gap-6">
      <UltraOrb size={120} state={arena && playing ? "working" : state} className="-ml-2 mb-1" />
      <div className="snap-grow w-full min-w-0 sm:w-auto sm:flex-1" data-testid="mode-cast" data-open={arena} data-kind={kind ?? "chat"} inert={!arena}>
        <div className="pb-1 pl-1 pr-6 pt-3">
          {present && (kind === "battle" || kind === "loop") && count !== null && (
            <div key={kind} className="cast-in">
              {kind === "battle" ? <BattleCast n={count} onPlaying={setPlaying} /> : <LoopCast n={count} onPlaying={setPlaying} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
