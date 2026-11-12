"use client";
import { useEffect, useMemo, type CSSProperties } from "react";
import { BattleOrb } from "@/components/orbs/Orbs";
import { lookFor } from "@/components/orbs/palette";
import { battlePreview, battleTape } from "@/lib/arena/preview";
import type { Pose } from "@/lib/arena/replay";
import { CastCaption, Fit } from "./CastParts";
import { EASE, POP_STAGGER_MS, battleLayout, contactLeft, fighterPlace, lineState, slotLeft, stageHeight, teamLook, treeGeometry, type LineState } from "./cast";
import { useStagger, useTape } from "./useTape";

const REST: Pose = { x: 0, squash: 1, down: 0 };
const AT_HOME = { move: "translate(0px, 0px)", squash: "scale(1, 1)" };

/** Health as a hairline under an orb: the fill is the health now, and a fainter strip catches up a moment later, so a hit is felt as well as seen. Both only scale, so the browser moves them without redrawing. */
function Hp({ hp, width, top }: { hp: number; width: number; top: number }) {
  const left = Math.max(0, Math.min(100, hp)) / 100;
  return (
    <span className="absolute left-0 block h-[3px] overflow-hidden rounded-full bg-line" style={{ top, width }} role="presentation">
      <span className="absolute inset-0 origin-left bg-fg/25" style={{ transform: `scaleX(${left})`, transition: `transform 600ms ${EASE} 160ms` }} />
      <span className={`absolute inset-0 origin-left ${left < 0.25 ? "bg-bad" : "bg-fg"}`} style={{ transform: `scaleX(${left})`, transition: `transform 220ms ${EASE}, background-color 220ms` }} />
    </span>
  );
}

const LINE_TONE: Record<LineState, string> = { idle: "stroke-dock-line", live: "stroke-accent", won: "stroke-fg-muted", lost: "stroke-line" };

/** A team's colours as a small flat disc: the same gradient as its orb, with no script running in it. */
function Token({ orb, r, className = "" }: { orb: string; r: number; className?: string }) {
  const look = lookFor(orb, "battle");
  const c = look.kind === "gradient" ? look.colors : (["#7C6AF7", "#7DD3C7", "#E8B4D4"] as const);
  return <span className={`block rounded-full ${className}`} style={{ width: r * 2, height: r * 2, background: `linear-gradient(135deg, ${c[0]}, ${c[1]} 55%, ${c[2]})` }} />;
}

/**
 * The preview you get when the mode is Battle. The picked number of team orbs pop in one after another, then the real knockout plays: the two
 * fighters step up onto a stage, lunge, hit and recoil exactly as in the Battle's own replay (same frames, same health arithmetic), the loser sinks,
 * the winner goes on, and the champion is lit. Under the orbs the knockout is drawn as a bracket: it draws itself in, lights the two teams' lines
 * while their match is on, puts the winner on the match when it is over, and ends with the champion under the final. The scores are stand-ins
 * (nothing has run).
 *
 * It is kept light on purpose. The dot-sphere orbs redraw hundreds of dots in script every frame, which a row of them cannot afford, so they are
 * held on a frame (only the champion moves its dots, for the moment it is crowned) and they are put on the page one at a time rather than all at
 * once. The movement itself is the browser's (transforms and opacity), and health bars scale rather than resize.
 */
export function BattleCast({ n, onPlaying }: { n: number; onPlaying?: (playing: boolean) => void }) {
  const preview = useMemo(() => battlePreview(n), [n]);
  const tape = useMemo(() => battleTape(preview), [preview]);
  const layout = useMemo(() => battleLayout(n), [n]);
  const tree = useMemo(() => treeGeometry(layout, preview.order, preview.tree), [layout, preview]);
  const { beat, done, still, replay, at } = useTape(tape, { cycles: 1 });
  const ready = useStagger(preview.teams.length, POP_STAGGER_MS);
  useEffect(() => {
    onPlaying?.(!done);
    return () => onPlaying?.(false);
  }, [done, onPlaying]);
  const match = beat.match !== null ? preview.matches[beat.match] : null;
  const contact = contactLeft(layout, beat.frame);
  const team = new Map(preview.teams.map((t) => [t.id, t]));
  const ended = beat.kind === "crown" || beat.kind === "rest";
  /** The bracket draws in after the orbs have popped in. */
  const treeAfter = preview.teams.length * POP_STAGGER_MS + 120;

  return (
    <figure data-testid="battle-cast" data-n={n} data-beat={beat.kind} data-done={done} className="m-0">
      <Fit width={layout.box} height={layout.height} reserve={stageHeight()}>
        <div className="relative" style={{ width: layout.box, height: layout.height }} role="img" aria-label={`A preview of a Battle: ${n} teams argue opposite predictions, then a knockout picks one`}>
          <svg className="pointer-events-none absolute left-0 top-0" width={layout.box} height={layout.height} aria-hidden data-testid="battle-tree">
            {tree.lines.map((line) => (
              <path key={line.id} d={line.d} pathLength={1} fill="none" strokeWidth={1.3} strokeLinejoin="round" className={`tree-draw ${LINE_TONE[lineState(beat, line)]}`} style={{ animationDelay: `${treeAfter + (line.round - 1) * 190}ms`, transition: "stroke 240ms" }} />
            ))}
            {tree.champion.d && <path d={tree.champion.d} pathLength={1} fill="none" strokeWidth={1.3} className={`tree-draw ${ended ? "stroke-fg" : "stroke-dock-line"}`} style={{ animationDelay: `${treeAfter + tree.nodes.reduce((m, x) => Math.max(m, x.round), 0) * 190}ms`, transition: "stroke 240ms" }} />}
          </svg>
          {tree.nodes.map((node) => {
            const winner = beat.decided[node.id];
            const orb = winner ? team.get(winner)?.orb : undefined;
            const live = beat.live === node.id;
            return (
              <div key={node.id} data-testid="battle-node" data-node={node.id} data-winner={winner ?? ""} data-live={live} className="pointer-events-none absolute" style={{ left: node.x, top: node.y, width: 0, height: 0 }}>
                {!node.bye && !orb && <span className={`cast-pop absolute -left-[3px] -top-[3px] block size-1.5 rounded-full ${live ? "bg-accent" : "bg-dock-line"}`} style={{ animationDelay: `${treeAfter}ms` }} />}
                {live && <span className="tree-live absolute -left-2.5 -top-2.5 block size-5 rounded-full border border-accent/70" />}
                {orb && <span key={winner} className="cast-pop absolute -left-[7px] -top-[7px]" style={{ animationDelay: beat.kind === "gather" ? `${treeAfter + 150}ms` : "0ms" }}><Token orb={orb} r={7} /></span>}
                {!node.bye && <span className="absolute left-3 -top-[7px] whitespace-nowrap text-[9.5px] leading-[14px] text-fg-dim">{node.label}</span>}
              </div>
            );
          })}
          {ended && team.get(preview.champion) && (
            <div className="pointer-events-none absolute" style={{ left: tree.champion.x, top: tree.champion.y, width: 0, height: 0 }} data-testid="battle-champion">
              <span className="cast-pop absolute -left-[9px] -top-[9px] rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_16px_rgba(255,255,255,0.25)]"><Token orb={team.get(preview.champion)!.orb} r={9} /></span>
              <span className="fade-in absolute left-4 -top-[7px] whitespace-nowrap text-[10.5px] font-medium leading-[14px] text-fg">{team.get(preview.champion)!.name}</span>
            </div>
          )}
          {preview.order.map((id, slot) => {
            const t = team.get(id)!;
            const arrival = preview.teams.findIndex((x) => x.id === id);
            if (arrival >= ready) return null;
            const fighting = !!match && beat.kind === "frame" && (id === match.a || id === match.b);
            const side: "a" | "b" = match && id === match.a ? "a" : "b";
            const pose = fighting && beat.frame ? (side === "a" ? beat.frame.a : beat.frame.b) : REST;
            const place = fighting ? fighterPlace(layout, slot, side, pose) : AT_HOME;
            const look = teamLook(beat, id, fighting, preview.champion);
            const mover: CSSProperties = {
              transform: place.move,
              opacity: look.opacity * (1 - pose.down * 0.55),
              transition: `transform ${beat.ms || 300}ms ${EASE}, opacity 300ms ${EASE}`,
              zIndex: fighting ? 3 : 1,
            };
            return (
              <div key={id} data-testid="battle-orb" data-team={id} data-fighting={fighting} className="absolute" style={{ left: slotLeft(layout, slot), top: layout.lift, width: layout.size, transition: `left 420ms ${EASE}` }}>
                <div className="cast-pop">
                  <div className="relative" style={mover}>
                    <div style={{ transform: place.squash, transition: `transform ${beat.ms || 120}ms ${EASE}`, scale: String(look.scale), width: layout.size, height: layout.size }} className={`flex ${look.glow ? "rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_22px_rgba(255,255,255,0.22)]" : ""}`}>
                      <BattleOrb id={t.orb} size={layout.size} state="running" tool={t.tool} winner={look.glow} light paused={!look.glow || done} />
                    </div>
                    <Hp hp={beat.hp[id] ?? 100} width={layout.size} top={layout.size + 7} />
                    <span className={`absolute left-1/2 whitespace-nowrap text-[10.5px] leading-none ${look.glow ? "font-medium text-fg" : "text-fg-dim"}`} style={{ top: layout.size + 16, transform: `translateX(calc(-50% + ${fighting ? (side === "a" ? -14 : 14) : 0}px))`, transition: `transform 200ms ${EASE}` }}>{t.name}</span>
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
