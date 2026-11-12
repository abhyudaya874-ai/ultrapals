"use client";
import { useEffect, useMemo } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { loopPreview, loopTape, type RoundPreview } from "@/lib/arena/preview";
import { DIMENSIONS } from "@/lib/arena/types";
import { CastCaption, Fit } from "./CastParts";
import { EASE, POP_STAGGER_MS, arcPath, baton, fillOffset, loopLayout, ringCentre, roundLook, segments, stageHeight, tickPath, valueAngle, type RoundLook } from "./cast";
import { useStagger, useTape } from "./useTape";

/** Each of the five parts of a ring takes this long to draw, one after another, so the whole ring is drawn during the one turn of the orb (1000 ms). */
const SWEEP_MS = 190;
const STROKE = 3.4;

/**
 * One round's score as a ring of five parts, one per measure the judge gives. Each part fills in proportion to its measure. A small mark shows where
 * the round before left the measure this round was told to beat, and the part that comes out lowest is marked as the next round's target.
 */
function Ring({ size, round, before, look }: { size: number; round: RoundPreview; before: RoundPreview | null; look: RoundLook }) {
  const c = size / 2;
  const r = c - 3.5;
  const parts = segments();
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute left-0 top-0" aria-hidden>
      {DIMENSIONS.map((dim, i) => {
        const d = arcPath(c, r, parts[i].from, parts[i].to);
        const weakest = look.marked && dim === round.weakest;
        const aimed = look.aimed && dim === round.aimed;
        const delay = look.drawn ? i * SWEEP_MS : 0;
        const tone = weakest ? "stroke-warn" : aimed ? "stroke-accent" : look.crowned ? "stroke-fg" : "stroke-fg-dim";
        return (
          <g key={dim}>
            <path d={d} fill="none" strokeWidth={STROKE} strokeLinecap="round" className={look.pulse === "aimed" && aimed ? "seg-pulse stroke-accent" : "stroke-line"} />
            <path d={d} pathLength={1} fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={look.drawn ? fillOffset(round.dims[dim]) : 1}
              className={`${tone} ${look.pulse === "weakest" && weakest ? "seg-pulse" : ""}`}
              style={{ opacity: look.drawn ? 1 : 0, transition: `stroke-dashoffset ${SWEEP_MS + 40}ms ${EASE} ${delay}ms, opacity 100ms ${delay}ms, stroke 240ms` }} />
            {aimed && before && <path d={tickPath(c, r, valueAngle(i, before.dims[dim]))} fill="none" strokeWidth={1.7} strokeLinecap="round" className="fade-in stroke-accent" />}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The preview you get when the mode is Loop. The picked number of round orbs pop in, in a row. Then each takes its turn: it is told which measure of the
 * round before to beat (a baton carries that across), turns once all the way round while its ring is drawn, and has its weakest measure marked for the
 * next one. The best round is crowned and, as in a real Loop, the loop stops when a later round does not beat a good one. The scores are stand-ins.
 *
 * It is kept light: the dot-spheres redraw hundreds of dots in script every frame, which a row of them cannot afford, so they are held on a frame
 * (only the crowned one moves its dots, for the moment it is crowned); the turn itself is a transform, which the browser does. The orbs are put on
 * the page one at a time and never rebuilt as they change turns.
 */
export function LoopCast({ n, onPlaying }: { n: number; onPlaying?: (playing: boolean) => void }) {
  const preview = useMemo(() => loopPreview(n), [n]);
  const tape = useMemo(() => loopTape(preview), [preview]);
  const layout = useMemo(() => loopLayout(n), [n]);
  const { beat, done, still, replay } = useTape(tape, { cycles: 1 });
  const ready = useStagger(preview.rounds.length, POP_STAGGER_MS);
  useEffect(() => {
    onPlaying?.(!done);
    return () => onPlaying?.(false);
  }, [done, onPlaying]);

  const bat = baton(beat, (round) => preview.rounds[round - 1].weakest);
  const batAt = bat.at ?? (beat.round !== null ? beat.round - 1 : 0);
  const { ring, orb, lane, pitch } = layout;

  return (
    <figure data-testid="loop-cast" data-n={n} data-beat={beat.kind} data-round={beat.round ?? ""} data-done={done} className="m-0">
      <Fit width={layout.width} height={layout.height} reserve={stageHeight()}>
        <div className="relative" style={{ width: layout.width, height: layout.height }} role="img" aria-label={`A preview of a Loop: ${n} rounds in a row, each told to beat the weakest measure of the one before`}>
          {preview.rounds.slice(1).map((r, i) => (
            <span key={r.round} aria-hidden className={`absolute h-px ${roundLook(beat, r.round, preview.bestRound).aimed ? "bg-fg-dim" : "bg-line"}`} style={{ left: i * pitch + ring + 4, width: pitch - ring - 8, top: lane + ring / 2, transition: "background-color 240ms" }} />
          ))}
          {preview.rounds.map((r, i) => {
            if (i >= ready) return null;
            const look = roundLook(beat, r.round, preview.bestRound);
            const ended = beat.kind === "crown" || beat.kind === "rest";
            const opacity = ended ? (look.crowned ? 1 : look.spent ? 0.35 : 0.6) : look.drawn || look.spinning || look.aimed ? 1 : 0.5;
            return (
              <div key={r.round} data-testid="loop-orb" data-round={r.round} data-spinning={look.spinning} className="absolute top-0" style={{ left: i * pitch, width: ring, height: layout.height, transition: `left 420ms ${EASE}` }}>
                <div className="cast-pop relative size-full">
                  <div className="absolute left-0" style={{ top: lane, width: ring, height: ring, opacity, transition: `opacity 300ms ${EASE}` }}>
                    <Ring size={ring} round={r} before={i > 0 ? preview.rounds[i - 1] : null} look={look} />
                    <div className={`absolute flex rounded-full ${look.spinning ? "cast-spin" : ""} ${look.crowned ? "shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_20px_rgba(255,255,255,0.2)]" : ""}`} style={{ left: (ring - orb) / 2, top: (ring - orb) / 2, width: orb, height: orb }}>
                      <BattleOrb id={r.orb} size={orb} state="running" tool={r.tool} winner={look.crowned} light paused={!look.crowned || done} />
                    </div>
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center leading-none" style={{ top: lane + ring + 5 }}>
                    <div className="flex h-4 items-center justify-center gap-1 text-[10.5px] tabular-nums">
                      <span className={look.crowned ? "font-medium text-fg" : "text-fg-dim"}>{look.crowned ? "best" : `R${r.round}`}</span>
                      {look.drawn && <span className={look.crowned ? "text-fg" : "text-fg-muted"}>{r.score.toFixed(1)}</span>}
                      {look.drawn && r.delta !== null && <span className={r.delta >= 0 ? "text-ok" : "text-bad"}>{r.delta >= 0 ? "▲" : "▼"}{Math.abs(r.delta).toFixed(1)}</span>}
                    </div>
                    <div className="h-3.5 text-[10px] text-warn">{look.marked ? r.weakest : ""}</div>
                  </div>
                </div>
              </div>
            );
          })}
          <span aria-hidden data-testid="loop-baton" data-at={bat.at ?? ""} className="absolute z-[2] flex h-4 -translate-x-1/2 items-center whitespace-nowrap rounded-full border border-accent/60 bg-canvas px-1.5 text-[10px] leading-none text-accent"
            style={{ left: ringCentre(layout, batAt), top: 3, opacity: bat.at === null ? 0 : 1, transition: `left ${beat.kind === "pass" ? beat.ms : 0}ms ${EASE}, opacity 180ms` }}>
            {bat.carries ? `aim: ${bat.carries}` : <span className="block size-1.5 rounded-full bg-accent" />}
          </span>
        </div>
      </Fit>
      <CastCaption text={beat.caption} done={done} still={still} onReplay={replay} />
    </figure>
  );
}
