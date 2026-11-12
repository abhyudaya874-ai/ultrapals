"use client";
import { useEffect, useMemo, type CSSProperties } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { battlePreview, battleTape } from "@/lib/arena/preview";
import type { Pose } from "@/lib/arena/replay";
import { CastCaption, Fit } from "./CastParts";
import { EASE, POP_STAGGER_MS, battleLayout, contactLeft, fighterPlace, slotLeft, stageHeight, teamLook } from "./cast";
import { useTape } from "./useTape";

const REST: Pose = { x: 0, squash: 1, down: 0 };
const AT_HOME = { move: "translate(0px, 0px)", squash: "scale(1, 1)" };

/** Health as a hairline under an orb: the fill is the health now, and a fainter strip catches up a moment later, so a hit is felt as well as seen. */
function Hp({ hp, width, top }: { hp: number; width: number; top: number }) {
  const pct = Math.max(0, Math.min(100, hp));
  return (
    <span className="absolute left-0 block h-[3px] overflow-hidden rounded-full bg-line" style={{ top, width }} role="presentation">
      <span className="absolute inset-y-0 left-0 bg-fg/25" style={{ width: `${pct}%`, transition: `width 600ms ${EASE} 160ms` }} />
      <span className={`absolute inset-y-0 left-0 ${pct < 25 ? "bg-bad" : "bg-fg"}`} style={{ width: `${pct}%`, transition: `width 220ms ${EASE}, background-color 220ms` }} />
    </span>
  );
}

/**
 * The preview you get when the mode is Battle. The picked number of team orbs pop in one after another, then the real knockout plays: the two
 * fighters step up onto a stage, lunge, hit and recoil exactly as in the Battle's own replay (same frames, same health arithmetic), the loser sinks,
 * the winner goes on, and the champion is lit. The scores are stand-ins (nothing has run), and the line under it says so.
 */
export function BattleCast({ n, onPlaying }: { n: number; onPlaying?: (playing: boolean) => void }) {
  const preview = useMemo(() => battlePreview(n), [n]);
  const tape = useMemo(() => battleTape(preview), [preview]);
  const layout = useMemo(() => battleLayout(n), [n]);
  const { beat, done, still, replay, at } = useTape(tape, { cycles: 1 });
  useEffect(() => {
    onPlaying?.(!done);
    return () => onPlaying?.(false);
  }, [done, onPlaying]);
  const match = beat.match !== null ? preview.matches[beat.match] : null;
  const contact = contactLeft(layout, beat.frame);
  const team = new Map(preview.teams.map((t) => [t.id, t]));

  return (
    <figure data-testid="battle-cast" data-n={n} data-beat={beat.kind} data-done={done} className="m-0">
      <Fit width={layout.box} height={layout.height} reserve={stageHeight()}>
        <div className="relative" style={{ width: layout.box, height: layout.height }} role="img" aria-label={`A preview of a Battle: ${n} teams argue opposite predictions, then a knockout picks one`}>
          {preview.order.map((id, slot) => {
            const t = team.get(id)!;
            const arrival = preview.teams.findIndex((x) => x.id === id);
            const fighting = !!match && beat.kind === "frame" && (id === match.a || id === match.b);
            const side: "a" | "b" = match && id === match.a ? "a" : "b";
            const pose = fighting && beat.frame ? (side === "a" ? beat.frame.a : beat.frame.b) : REST;
            const place = fighting ? fighterPlace(layout, slot, side, pose) : AT_HOME;
            const look = teamLook(beat, id, fighting, preview.champion);
            const alive = beat.alive.includes(id);
            const mover: CSSProperties = {
              transform: place.move,
              opacity: look.opacity * (1 - pose.down * 0.55),
              filter: `grayscale(${Math.max(look.gray, pose.down)})`,
              transition: `transform ${beat.ms || 300}ms ${EASE}, opacity 300ms ${EASE}, filter 300ms ${EASE}`,
              zIndex: fighting ? 3 : 1,
            };
            return (
              <div key={id} data-testid="battle-orb" data-team={id} data-fighting={fighting} className="absolute" style={{ left: slotLeft(layout, slot), top: layout.lift, width: layout.size, transition: `left 420ms ${EASE}` }}>
                <div className="cast-pop" style={{ animationDelay: `${arrival * POP_STAGGER_MS}ms` }}>
                  <div className="relative" style={mover}>
                    <div style={{ transform: place.squash, transition: `transform ${beat.ms || 120}ms ${EASE}`, scale: String(look.scale), width: layout.size, height: layout.size }} className={`flex ${look.glow ? "rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_22px_rgba(255,255,255,0.22)]" : ""}`}>
                      <BattleOrb id={t.orb} size={layout.size} state={alive ? "running" : "ok"} tool={t.tool} winner={look.glow} />
                    </div>
                    <Hp hp={beat.hp[id] ?? 100} width={layout.size} top={layout.size + 7} />
                    <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] leading-none ${look.glow ? "font-medium text-fg" : "text-fg-dim"}`} style={{ top: layout.size + 16 }}>{t.name}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {contact !== null && <span key={at} data-testid="battle-hit" className="duel-ring pointer-events-none absolute z-[4] size-9 rounded-full border border-fg/40" style={{ left: contact, top: layout.size / 2 }} aria-hidden />}
        </div>
      </Fit>
      <CastCaption text={beat.caption} done={done} still={still} onReplay={replay} />
    </figure>
  );
}
