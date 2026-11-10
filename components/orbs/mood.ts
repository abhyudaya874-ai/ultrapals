import type { OrbState } from "@yogesharc/thinking-orbs";
import type { Run } from "@/lib/computer/run";
import type { Look } from "./gaze";

export type Mood = "idle" | "thinking" | "busy" | "done" | "error";

/** Pure. Where the eyes drift when nobody steers them, from two random numbers in 0..1. A thinking orb looks up and around, a busy one looks down at its work. */
export function moodLook(mood: Mood, a: number, b: number): Look {
  const wide = (a * 2 - 1) * 0.8;
  const tall = (b * 2 - 1) * 0.5;
  switch (mood) {
    case "thinking": return { x: wide * 0.9, y: 0.25 + b * 0.55 };
    case "busy": return { x: wide * 0.5, y: -0.15 - b * 0.35 };
    case "error": return { x: -0.35 - a * 0.3, y: -0.35 - b * 0.2 };
    default: return { x: wide, y: tall + 0.08 };
  }
}

/** Pure. How closed the eyes rest, 0 (wide) to 1: a busy orb squints a little, a worried one more. */
export const squint = (mood: Mood): number => (mood === "busy" ? 0.22 : mood === "error" ? 0.4 : mood === "thinking" ? 0.08 : 0);

/** Pure. How often the glance changes, in ms: a thinking orb is quick, a busy one is steady. */
export const glanceEvery = (mood: Mood): [number, number] => (mood === "thinking" ? [500, 1100] : mood === "busy" ? [1400, 2800] : [900, 3000]);

export type UltraState = "idle" | "thinking" | "working" | "talking" | "error";
/**
 * Pure. What UltraPal is doing right now, from the latest run: talking once the answer is streaming, working while a subagent or a contender runs,
 * thinking while it plans, error after a failed run, otherwise idle.
 */
export function ultraState(run: Run | undefined, busy: boolean): UltraState {
  if (!run) return "idle";
  const working = run.agents.some((a) => a.role !== "main" && a.state === "running") || (run.arena?.contenders.some((c) => c.state === "running") ?? false);
  if (!busy) return run.status === "error" ? "error" : "idle";
  if (run.answer.length > 0) return "talking";
  return working ? "working" : "thinking";
}

/** Pure. Which Thinking Orb animation shows what a contender is doing. */
export function thinkingState(o: { state: "pending" | "running" | "ok" | "error"; tool: "research" | "browser" | "terminal"; judging?: boolean }): OrbState {
  if (o.judging) return "compacting";
  if (o.state === "pending") return "waiting";
  if (o.state === "error") return "retrying";
  if (o.state === "ok") return "idle";
  return o.tool === "research" ? "searching" : o.tool === "browser" ? "using" : "working";
}

export const moodOf = (state: "pending" | "running" | "ok" | "error"): Mood => (state === "error" ? "error" : state === "running" ? "busy" : state === "pending" ? "thinking" : "done");

