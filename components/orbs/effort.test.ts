import { describe, expect, it } from "vitest";
import { LEVELS } from "@/lib/computer/models";
import { EFFORT_THEME, effortOf, growStyle } from "./effort";

const HEX = /^#[0-9a-f]{6}$/i;
const hue = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
};

describe("the effort theme", () => {
  it("covers every level, and the colours go green, blue, red, purple in that order", () => {
    expect(LEVELS.map((l) => EFFORT_THEME[l].name)).toEqual(["green", "blue", "red", "purple"]);
  });
  it("every colour is a real colour of the family its name says", () => {
    const inFamily: Record<string, (h: number) => boolean> = { green: (h) => h >= 90 && h <= 160, blue: (h) => h >= 200 && h <= 240, red: (h) => h <= 10 || h >= 350, purple: (h) => h >= 250 && h <= 290 };
    for (const l of LEVELS) {
      const t = EFFORT_THEME[l];
      expect(t.color).toMatch(HEX);
      expect(inFamily[t.name](hue(t.color)), `${l}: ${t.color} is hue ${hue(t.color)}`).toBe(true);
      for (const stop of t.orb) expect(stop).toMatch(HEX);
    }
  });
  it("the gradient's first stop is in the same family as the level's colour (hues are a circle: red sits at both 0 and 360)", () => {
    for (const l of LEVELS) {
      const d = Math.abs(hue(EFFORT_THEME[l].orb[0]) - hue(EFFORT_THEME[l].color));
      expect(Math.min(d, 360 - d), l).toBeLessThanOrEqual(30);
    }
  });
  it("no two levels share a colour or a gradient", () => {
    expect(new Set(LEVELS.map((l) => EFFORT_THEME[l].color)).size).toBe(4);
    expect(new Set(LEVELS.map((l) => EFFORT_THEME[l].orb.join())).size).toBe(4);
  });
  it("orbs grow a little with each step of effort, and standard is the size they were drawn at", () => {
    const s = LEVELS.map((l) => EFFORT_THEME[l].scale);
    expect(s).toEqual([...s].sort((a, b) => a - b));
    expect(new Set(s).size).toBe(4);
    expect(EFFORT_THEME.standard.scale).toBe(1);
    for (const v of s) expect(v).toBeGreaterThanOrEqual(0.85); // a little, not a different orb
    for (const v of s) expect(v).toBeLessThanOrEqual(1.25);
  });
});

describe("effortOf", () => {
  it("is Standard for a level nobody knows", () => {
    expect(effortOf(undefined)).toBe(EFFORT_THEME.standard);
    expect(effortOf("turbo" as never)).toBe(EFFORT_THEME.standard);
    expect(effortOf("ultra")).toBe(EFFORT_THEME.ultra);
  });
});

describe("growStyle", () => {
  it("scales without moving anything, and eases the change", () => {
    expect(growStyle(1.16)).toEqual({ scale: "1.16", transition: "scale 160ms cubic-bezier(0.2, 0.8, 0.2, 1)" });
  });
});
