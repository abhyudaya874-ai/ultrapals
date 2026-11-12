"use client";
import { Orb as DotOrb } from "@yogesharc/thinking-orbs";
import { halftone } from "@yogesharc/thinking-orbs/renders";
import { cube, octahedron, tetrahedron, torus } from "@yogesharc/thinking-orbs/shapes";
import { memo, useEffect, useId, useState } from "react";
import { LiveOrb } from "@/components/ui/live-orb";
import type { Level } from "@/lib/computer/models";
import { cn } from "@/lib/utils";
import { gpuBudget } from "./budget";
import { growStyle } from "./effort";
import { useEffort } from "./EffortContext";
import { Eyes } from "./Eyes";
import { moodOf, thinkingState, type Mood, type UltraState } from "./mood";
import { eyeOn, lookFor, roleOf, type OrbLook } from "./palette";

/** A GPU slot for a live (WebGL) orb. Without one the orb is drawn flat, which costs no context and still has moving eyes. */
function useGpuSlot(want: boolean): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!want || !gpuBudget.acquire()) {
      setOk(false);
      return;
    }
    setOk(true);
    return () => {
      gpuBudget.release();
      setOk(false);
    };
  }, [want]);
  return ok;
}

const body = (look: OrbLook): string => (look.kind === "plain" ? look.color : `linear-gradient(135deg, ${look.colors[0]}, ${look.colors[1]} 55%, ${look.colors[2]})`);

/** A shaded disc with the same moving eyes, no GPU: what a finished agent, or one past the GPU budget, looks like. */
export const FlatOrb = memo(function FlatOrb({ size, look, mood = "idle", interactive = true, className, level }: { size: number; look: OrbLook; mood?: Mood; interactive?: boolean; className?: string; level?: Level }) {
  const effort = useEffort(level);
  return (
    <span className={cn("relative inline-block shrink-0 align-middle", className)} style={{ width: size, height: size, ...growStyle(effort.scale) }} role="img" aria-label="Agent">
      <span className="absolute inset-[2%] rounded-full" style={{ background: body(look), boxShadow: `inset 0 -${size * 0.1}px ${size * 0.18}px rgba(0,0,0,0.22), inset 0 ${size * 0.06}px ${size * 0.14}px rgba(255,255,255,0.35)` }} />
      <Eyes size={size} color={look.eye} mood={mood} interactive={interactive} />
    </span>
  );
});

/**
 * An agent as a little character. The working agents (research, browser, terminal) are one plain colour each, the Pals and SuperPals a gradient of
 * their own, all with the same eyes. While `live` (it is working) it is the WebGL orb; otherwise, or past the GPU budget, the flat one.
 */
export const AgentOrb = memo(function AgentOrb({ id, role, size = 22, live = false, mood = "idle", interactive = false, className, level }: { id: string; role?: string; size?: number; live?: boolean; mood?: Mood; interactive?: boolean; className?: string; level?: Level }) {
  const look = lookFor(id, role ?? roleOf(id));
  const gpu = useGpuSlot(live);
  const effort = useEffort(level);
  if (!gpu) return <FlatOrb size={size} look={look} mood={mood} interactive={interactive} className={className} level={level} />;
  const style = growStyle(effort.scale);
  return look.kind === "plain"
    ? <LiveOrb size={size} variant="custom" color={look.color} eyeColor={look.eye} interactive={interactive} className={className} style={style} />
    : <LiveOrb size={size} variant="webgl" colors={[...look.colors]} interactive={interactive} className={className} style={style} />;
});

/* ───────────────────────── battle and loop agents: Thinking Orbs with eyes ───────────────────────── */

const SHAPES = [undefined, cube, octahedron, torus, tetrahedron] as const;

/**
 * A battle or loop agent: a Thinking Orb (a sphere of moving dots) in a gradient of its own, with a face. The gradient is painted by pointing the
 * dots' fill at an SVG gradient; the dots' own animation is the library's.
 *
 * The library redraws every dot, in script, on every frame: a few hundred for most states and about a thousand for a browser agent (it draws an
 * arrow in them). That is fine for one orb and too much for a row of them. `paused` holds an orb on its current frame (it costs nothing, and is
 * not redrawn, so changing it does not rebuild the orb), and `light` draws a sparser sphere in the plain-working look whatever the tool is,
 * about a fifth of the work. The home screen's preview uses both.
 */
export const BattleOrb = memo(function BattleOrb({ id, size = 56, state, tool, judging = false, winner = false, shape = 0, className, level, paused = false, light = false }: { id: string; size?: number; state: "pending" | "running" | "ok" | "error"; tool: "research" | "browser" | "terminal"; judging?: boolean; winner?: boolean; shape?: number; className?: string; level?: Level; paused?: boolean; light?: boolean }) {
  const effort = useEffort(level);
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const look = lookFor(id, "battle");
  const colors = look.kind === "gradient" ? look.colors : (["#7C6AF7", "#7DD3C7", "#E8B4D4"] as const);
  const sh = SHAPES[shape % SHAPES.length];
  return (
    <span className={cn("relative inline-block shrink-0 align-middle", className)} style={{ width: size, height: size, ...growStyle(effort.scale) }} role="img" aria-label={`${id} agent`}>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={size} y2={size}>
            <stop offset="0%" stopColor={colors[0]} />
            <stop offset="55%" stopColor={colors[1]} />
            <stop offset="100%" stopColor={colors[2]} />
          </linearGradient>
        </defs>
      </svg>
      <span className={cn("absolute inset-[6%] rounded-full transition-shadow", winner && "ring-1 ring-white/40")} style={{ background: `radial-gradient(circle at 35% 30%, ${colors[1]}33, ${colors[0]}14 60%, transparent 75%)` }} />
      <span className="absolute inset-0 orb-gradient" style={{ ["--orb-fill" as string]: `url(#${gid})` }}>
        <DotOrb state={thinkingState({ state, tool: light ? "terminal" : tool, judging })} size={size} density={light ? 0.55 : size > 40 ? 1.1 : 0.85} dotSize={light ? 1.6 : size > 40 ? 1.15 : 1.5} paused={paused} shape={sh} render={sh ? halftone : undefined} label={`${id}: ${state}`} />
      </span>
      <Eyes size={size} color={eyeOn(colors[1])} mood={judging ? "thinking" : moodOf(state)} interactive />
    </span>
  );
});

/* ───────────────────────── UltraPal ───────────────────────── */

/**
 * UltraPal: the lead. One soft gradient sphere with eyes, floating a little. Its colours follow the effort level (green, blue, red, purple) and
 * it grows a little with each step. Its state is in the eyes (they look up while it thinks, squint while it works) and, only while it is busy, in a
 * faint halo that breathes. `level` is for a form that has its own effort slider; elsewhere the conversation's level is used.
 */
export const UltraOrb = memo(function UltraOrb({ size = 120, state = "idle", className, level }: { size?: number; state?: UltraState; className?: string; level?: Level }) {
  const core = Math.round(size * 0.72);
  const gpu = useGpuSlot(true);
  const effort = useEffort(level);
  const palette = effort.orb;
  const flat = { kind: "gradient", colors: palette, eye: "#0C0C10" } as const;
  const busy = state === "thinking" || state === "working";
  const glow = state === "error" ? "#f87171" : state === "working" ? palette[1] : palette[0];
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size, ...growStyle(effort.scale) }} role="img" aria-label={`UltraPal is ${state === "idle" ? "ready" : state}`} data-testid="ultra-orb" data-state={state} data-effort={effort.name}>
      {busy && <span aria-hidden className="ultra-halo absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, ${glow}33 0%, transparent 68%)` }} />}
      <span className="ultra-float absolute" style={{ left: (size - core) / 2, top: (size - core) / 2, width: core, height: core }}>
        {gpu ? <LiveOrb size={core} variant="webgl" colors={palette} interactive /> : <FlatOrb size={core} look={flat} mood={state === "error" ? "error" : busy ? "thinking" : "idle"} level={level} />}
      </span>
    </span>
  );
});
