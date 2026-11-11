import { LEVELS, type Level } from "@/lib/computer/models";

/**
 * What each effort level looks like. One table feeds the slider's fill, the pill's dots, UltraPal's gradient and the size of every orb, so they
 * change together: light is green, standard blue, high red, ultra purple, and the orbs grow a little with each step.
 */
export interface EffortTheme {
  name: "green" | "blue" | "red" | "purple";
  /** The slider's fill and the pill's dots. */
  color: string;
  /** The three stops of UltraPal's gradient (and the halo it breathes in while it works). */
  orb: [string, string, string];
  /** Orbs are drawn at this multiple of their size: standard is the size they were designed at. */
  scale: number;
}

export const EFFORT_THEME: Record<Level, EffortTheme> = {
  light: { name: "green", color: "#7fd99a", orb: ["#22c55e", "#86efac", "#d9f99d"], scale: 0.92 },
  standard: { name: "blue", color: "#5b9cf5", orb: ["#3b82f6", "#60a5fa", "#a5f3fc"], scale: 1 },
  high: { name: "red", color: "#ef6b73", orb: ["#ef4444", "#fb7185", "#fdba74"], scale: 1.08 },
  ultra: { name: "purple", color: "#a77bf3", orb: ["#8b5cf6", "#c084fc", "#f0abfc"], scale: 1.16 },
};

/** Pure. The theme for a level; a level that is not known (stale saved data) is Standard. */
export const effortOf = (level: Level | undefined): EffortTheme => EFFORT_THEME[level && LEVELS.includes(level) ? level : "standard"];

/** Pure. The style that makes an orb a little bigger without moving anything around it (the layout does not change, only what is drawn). */
export const growStyle = (scale: number): { scale: string; transition: string } => ({ scale: String(scale), transition: "scale 160ms cubic-bezier(0.2, 0.8, 0.2, 1)" });
