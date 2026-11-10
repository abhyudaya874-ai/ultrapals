import { describe, expect, it } from "vitest";
import { MAX_HP, duel, type Fighter } from "./duel";
import { replay, replayMs } from "./replay";
import type { Dim } from "./types";

const dims = (n: number, over: Partial<Record<Dim, number>> = {}): Record<Dim, number> => ({ evidence: n, consistency: n, calibration: n, actionability: n, fit: n, ...over });
const F = (id: string, d: Record<Dim, number> | null, o: Partial<Fighter> = {}): Fighter => ({ id, hp: MAX_HP, dims: d, det: 5, facts: { sources: 0, cited: 0, roles: [], files: 0, failed: false }, ...o });

describe("replay: the orbs close in, hit, recoil", () => {
  const d = duel(F("a", dims(9, { calibration: 4 })), F("b", dims(6)));
  const frames = replay(d);
  const hits = frames.filter((f) => f.kind === "hit");

  it("starts with the orbs coming close and ends on the duel's own result", () => {
    expect(frames[0]).toMatchObject({ kind: "intro", hp: d.from });
    expect(frames.at(-1)).toMatchObject({ kind: "end", hp: d.hp });
  });
  it("plays one lunge, hit and recoil for every hit that landed, hardest first", () => {
    expect(hits).toHaveLength(d.hits.length);
    expect(frames.filter((f) => f.kind === "lunge")).toHaveLength(d.hits.length);
    expect(frames.filter((f) => f.kind === "recoil")).toHaveLength(d.hits.length);
    const dealt = hits.map((h) => h.hit!.dealt);
    expect(dealt).toEqual([...dealt].sort((x, y) => y - x));
  });
  it("on a hit the two orbs touch: their poses add up to 2", () => {
    for (const h of hits) expect(h.a.x + h.b.x).toBeCloseTo(2, 5);
  });
  it("the one hit is flattened more than the one that hit", () => {
    for (const h of hits) {
      const [att, def] = h.hit!.by === "a" ? [h.a, h.b] : [h.b, h.a];
      expect(def.squash).toBeLessThan(att.squash);
    }
  });
  it("health only goes down, drops on the hit frame, and only for the one that was hit", () => {
    let prev = { ...d.from };
    for (const f of frames) {
      expect(f.hp.a).toBeLessThanOrEqual(prev.a);
      expect(f.hp.b).toBeLessThanOrEqual(prev.b);
      if (f.hit) {
        const def = f.hit.by === "a" ? "b" : "a";
        const att = f.hit.by;
        expect(f.hp[att]).toBe(prev[att]);
        expect(f.hp[def]).toBeLessThan(prev[def]);
      }
      prev = f.hp;
    }
  });
  it("the knocked-back orb moves away from the one that hit it", () => {
    const i = frames.findIndex((f) => f.kind === "recoil");
    const by = hits[0].hit!.by;
    const def = by === "a" ? "b" : "a";
    expect(frames[i][def].x).toBeLessThan(hits[0][def].x);
    expect(frames[i][by].x).toBeLessThan(hits[0][by].x);
  });
  it("a short fight: even five blows play in under three seconds", () => {
    expect(frames.filter((f) => f.kind === "hit")).toHaveLength(5);
    expect(replayMs(frames)).toBeLessThan(3000);
  });
});

describe("replay: endings", () => {
  it("a knock-out lowers and fades the loser, and the winner stays forward", () => {
    const d = duel(F("a", dims(10)), F("b", dims(0)));
    expect(d.ko).toBe(true);
    const end = replay(d).at(-1)!;
    expect(end.b.down).toBe(1);
    expect(end.hp.b).toBe(0);
    expect(end.a.x).toBeGreaterThan(end.b.x);
    expect(end.a.down).toBe(0);
  });
  it("a win on health leaves the loser standing but dimmed", () => {
    const end = replay(duel(F("a", dims(7)), F("b", dims(6)))).at(-1)!;
    expect(end.b.down).toBeGreaterThan(0);
    expect(end.b.down).toBeLessThan(1);
  });
  it("the winner can be either side", () => {
    const end = replay(duel(F("a", dims(3)), F("b", dims(8)))).at(-1)!;
    expect(end.b.down).toBe(0);
    expect(end.a.down).toBeGreaterThan(0);
    expect(end.b.x).toBeGreaterThan(end.a.x);
  });
  it("a dead-level match has no hit damage: they touch, bounce, and the winner is decided without a blow", () => {
    const d = duel(F("a", dims(6), { det: 6 }), F("b", dims(6), { det: 5 }));
    const f = replay(d);
    expect(d.hits).toEqual([]);
    expect(f.filter((x) => x.hit)).toEqual([]);
    expect(f.some((x) => x.kind === "hit" && x.a.x + x.b.x === 2)).toBe(true);
    expect(f.at(-1)!.hp).toEqual({ a: MAX_HP, b: MAX_HP });
  });
  it("is the same every time", () => {
    const d = duel(F("a", dims(8, { fit: 3 })), F("b", dims(5)));
    expect(replay(d)).toEqual(replay(d));
  });
});
