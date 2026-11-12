import { describe, expect, it } from "vitest";
import { battlePreview, battleTape, loopPreview, loopTape } from "@/lib/arena/preview";
import { DIMENSIONS } from "@/lib/arena/types";
import { CAPTION_H, CHAMPION_ROW, LEVEL_H, arcPath, baton, battleLayout, castHeight, contactLeft, fighterPlace, fillOffset, heroLine, heroTitle, lineState, loopLayout, polar, reachPx, ringCentre, roundLook, segments, slotLeft, stageHeight, standLeft, teamLook, tickPath, treeGeometry, valueAngle } from "./cast";

const COUNTS = [2, 3, 4, 5, 6];
const num = (s: string, re: RegExp): number => Number(re.exec(s)![1]);

describe("battleLayout: 2 to 6 orbs in the same space", () => {
  it("makes the orbs smaller as there are more of them, and never wider than the figure", () => {
    const sizes = COUNTS.map((n) => battleLayout(n).size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    for (const n of COUNTS) {
      const l = battleLayout(n);
      expect(l.width).toBeLessThanOrEqual(l.box);
      expect(l.width).toBe(n * l.pitch - l.gap);
      expect(l.offset * 2 + l.width).toBe(l.box);
    }
  });
  it("is wide enough for two fighters to stand apart on the stage, with the row beneath", () => {
    for (const n of COUNTS) {
      const l = battleLayout(n);
      expect(standLeft(l, "a")).toBeGreaterThanOrEqual(0);
      expect(standLeft(l, "b") + l.size).toBeLessThanOrEqual(l.box);
      expect(l.treeTop).toBeGreaterThanOrEqual(l.lift + l.size + 28); // under the names
      expect(l.height).toBe(l.treeTop + l.treeHeight);
    }
  });
  it("clamps a silly count", () => {
    expect(battleLayout(1)).toEqual(battleLayout(2));
    expect(battleLayout(40)).toEqual(battleLayout(6));
  });
});

describe("fighterPlace: the pose maths of the real Duel, on the stage", () => {
  const l = battleLayout(4);
  const dxOf = (slot: number, side: "a" | "b", pose: { x: number; squash: number; down: number }) => num(fighterPlace(l, slot, side, pose).move, /translate\((-?[\d.]+)px/);
  it("two fighters at pose x = 1 touch exactly in the middle of the figure", () => {
    const touching = { x: 1, squash: 1, down: 0 };
    expect(slotLeft(l, 0) + dxOf(0, "a", touching) + l.size).toBeCloseTo(l.box / 2, 1);
    expect(slotLeft(l, 3) + dxOf(3, "b", touching)).toBeCloseTo(l.box / 2, 1);
  });
  it("at x = 0 they stand a full arena apart, centre to centre", () => {
    const rest = { x: 0, squash: 1, down: 0 };
    const a = slotLeft(l, 1) + dxOf(1, "a", rest) + l.size / 2;
    const b = slotLeft(l, 2) + dxOf(2, "b", rest) + l.size / 2;
    expect(b - a).toBeCloseTo(l.arena, 1);
  });
  it("lifts a fighter onto the stage, above the row, and lowers it a little when beaten", () => {
    const dy = (down: number) => num(fighterPlace(l, 0, "a", { x: 0, squash: 1, down }).move, /px, (-?[\d.]+)px\)/);
    expect(dy(0)).toBe(-l.lift);
    expect(dy(1)).toBe(-l.lift + 6);
  });
  it("flattens along the hit: squash below 1 narrows x and stretches y, and that is only in `squash`, never in the move", () => {
    const p = fighterPlace(l, 0, "a", { x: 1, squash: 0.8, down: 0 });
    expect(p.squash).toBe("scale(0.8, 1.120)");
    expect(p.move).not.toMatch(/scale/);
    expect(fighterPlace(l, 0, "a", { x: 1, squash: 1, down: 0 }).squash).toBe("scale(1, 1.000)");
  });
  it("a fighter on the left moves right as x grows, and one on the right moves left, by exactly the reach", () => {
    const at = (side: "a" | "b", x: number) => dxOf(side === "a" ? 0 : 3, side, { x, squash: 1, down: 0 });
    expect(at("a", 1)).toBeGreaterThan(at("a", 0));
    expect(at("b", 1)).toBeLessThan(at("b", 0));
    expect(at("a", 1) - at("a", 0)).toBeCloseTo(reachPx(l), 1);
    expect(at("b", 0) - at("b", 1)).toBeCloseTo(reachPx(l), 1);
  });
});

describe("contactLeft: where the ring flashes", () => {
  it("is the attacker's far edge, and only on a hit", () => {
    for (const n of COUNTS) {
      const p = battlePreview(n);
      const l = battleLayout(n);
      for (const b of battleTape(p)) {
        const c = contactLeft(l, b.frame);
        if (b.frame?.hit) {
          expect(c).not.toBeNull();
          expect(c!).toBeGreaterThan(0);
          expect(c!).toBeLessThan(l.box);
        } else expect(c).toBeNull();
      }
    }
  });
  it("is at the middle when both are at the touching pose", () => {
    const l = battleLayout(4);
    const frame = { kind: "hit", ms: 1, hold: 0, a: { x: 1, squash: 1, down: 0 }, b: { x: 1, squash: 1, down: 0 }, hp: { a: 1, b: 1 }, hit: { by: "a", dim: "evidence", dealt: 1 } } as const;
    expect(contactLeft(l, frame)).toBeCloseTo(l.box / 2, 1);
  });
});

describe("teamLook", () => {
  const p = battlePreview(4);
  const tape = battleTape(p);
  it("lights everyone at the start", () => {
    for (const t of p.teams) expect(teamLook(tape[0], t.id, false, p.champion)).toMatchObject({ opacity: 1, gray: 0, glow: false });
  });
  it("during a match keeps the two fighters bright, dims the others who are still in, and fades the beaten", () => {
    const second = tape.find((b) => b.match === 2 && b.kind === "frame")!; // the final: the two semi-final losers are out
    const m = p.matches[2];
    expect(teamLook(second, m.a, true, p.champion).opacity).toBe(1);
    for (const out of [p.matches[0].loser, p.matches[1].loser]) expect(teamLook(second, out, false, p.champion)).toMatchObject({ opacity: 0.2, gray: 1 });
    const first = tape.find((b) => b.match === 0 && b.kind === "frame")!;
    const bystander = p.teams.map((t) => t.id).find((id) => id !== p.matches[0].a && id !== p.matches[0].b)!;
    expect(teamLook(first, bystander, false, p.champion).opacity).toBe(0.5);
  });
  it("lights only the champion at the end", () => {
    const crown = tape.find((b) => b.kind === "crown")!;
    expect(teamLook(crown, p.champion, false, p.champion)).toMatchObject({ opacity: 1, glow: true });
    const other = p.teams.find((t) => t.id !== p.champion)!.id;
    expect(teamLook(crown, other, false, p.champion)).toMatchObject({ opacity: 0.2, glow: false });
  });
});

describe("the knockout tree under the orbs", () => {
  for (const n of COUNTS) {
    const p = battlePreview(n);
    const l = battleLayout(n);
    const g = treeGeometry(l, p.order, p.tree);
    describe(`${n} teams`, () => {
      it("has as many rounds as the knockout needs, and a tree that fits under the orbs", () => {
        expect(l.levels).toBe(p.tree.length);
        expect(l.treeHeight).toBe(l.levels * LEVEL_H + CHAMPION_ROW);
        for (const node of g.nodes) {
          expect(node.x).toBeGreaterThanOrEqual(0);
          expect(node.x).toBeLessThanOrEqual(l.box);
          expect(node.y).toBeGreaterThan(l.treeTop);
          expect(node.y).toBeLessThan(l.height);
        }
        expect(g.champion.y).toBeLessThanOrEqual(l.height);
      });
      it("puts every match half way between the things that feed it, and each round lower than the one before", () => {
        const at = new Map(g.nodes.map((x) => [x.id, x]));
        for (const m of p.tree.flat()) {
          const xs = m.from.map((f) => ("team" in f ? slotLeft(l, p.order.indexOf(f.team)) + l.size / 2 : at.get(f.match)!.x));
          expect(at.get(m.id)!.x).toBeCloseTo(xs.reduce((a, b) => a + b, 0) / xs.length, 5);
          for (const f of m.from) if ("match" in f) expect(at.get(f.match)!.y).toBeLessThan(at.get(m.id)!.y);
        }
      });
      it("draws one line from every team to its first match and from every match to the next, and none else", () => {
        expect(g.lines).toHaveLength(n + (p.tree.flat().length - 1));
        expect(g.lines.filter((x) => x.team !== null).map((x) => x.team).sort()).toEqual([...p.order].sort());
      });
      it("starts each team's line at the centre of its orb, under its name", () => {
        for (const line of g.lines.filter((x) => x.team !== null)) {
          const cx = slotLeft(l, p.order.indexOf(line.team!)) + l.size / 2;
          expect(line.d.startsWith(`M ${cx.toFixed(1)} ${l.treeTop.toFixed(1)}`)).toBe(true);
        }
      });
      it("gives a bye one straight line, and joins every real match from two sides", () => {
        for (const m of p.tree.flat()) {
          const own = g.lines.filter((x) => x.to === m.id);
          expect(own).toHaveLength(m.bye ? 1 : 2);
          if (m.bye) expect(own[0].d).not.toContain("H");
        }
      });
      it("ends in one final, with the champion directly under it", () => {
        const final = g.nodes.filter((x) => x.round === l.levels);
        expect(final).toHaveLength(1);
        expect(final[0].label).toBe("Final");
        expect(g.champion.x).toBe(final[0].x);
        expect(g.champion.y).toBeGreaterThan(final[0].y);
      });
    });
  }
});

describe("lineState: which lines of the tree are lit in a beat", () => {
  const p = battlePreview(4);
  const l = battleLayout(4);
  const g = treeGeometry(l, p.order, p.tree);
  const tape = battleTape(p);
  const first = p.matches[0];
  const state = (b: (typeof tape)[number], to: string, team?: string) => lineState(b, g.lines.find((x) => x.to === to && (team ? x.team === team : x.team === null))!);
  it("lights nothing before anything is played", () => {
    for (const line of g.lines) expect(lineState(tape[0], line)).toBe("idle");
  });
  it("lights both teams' lines while their match is on", () => {
    const b = tape.find((x) => x.live === first.id)!;
    expect(state(b, first.id, first.a)).toBe("live");
    expect(state(b, first.id, first.b)).toBe("live");
  });
  it("lights the winner's line and dims the loser's once the match is over", () => {
    const end = tape.find((x) => x.live === first.id && x.frame?.kind === "end")!;
    expect(state(end, first.id, first.winner)).toBe("won");
    expect(state(end, first.id, first.loser)).toBe("lost");
  });
  it("lights the line up to the next match as soon as the winner is known, and dims it if that winner then loses", () => {
    const final = p.matches.at(-1)!;
    const finalLines = g.lines.filter((x) => x.to === final.id);
    const through = finalLines.find((x) => x.from === first.id)!;
    const after = tape.find((x) => x.decided[first.id] && x.live !== final.id && x.decided[p.matches[1].id] === undefined)!;
    expect(lineState(after, through)).toBe("won");
    const crown = tape.find((x) => x.kind === "crown")!;
    const fed = finalLines.map((x) => [x, p.matches.find((m) => m.id === x.from)!.winner] as const);
    for (const [line, who] of fed) expect(lineState(crown, line)).toBe(who === p.champion ? "won" : "lost");
  });
  it("has every team's line settled by the end: one bright per match, one dim", () => {
    const end = tape.at(-1)!;
    for (const m of p.tree.flat().filter((x) => !x.bye)) {
      const own = g.lines.filter((x) => x.to === m.id).map((x) => lineState(end, x));
      expect(own.sort()).toEqual(["lost", "won"]);
    }
  });
});

describe("loopLayout", () => {
  it("fits 2 to 6 rounds, smaller orbs for more of them", () => {
    const orbs = COUNTS.map((n) => loopLayout(n).orb);
    expect(orbs).toEqual([...orbs].sort((a, b) => b - a));
    for (const n of COUNTS) {
      const l = loopLayout(n);
      expect(l.width).toBe(n * l.pitch - (l.pitch - l.ring));
      expect(l.ring).toBeGreaterThan(l.orb);
      expect(l.width).toBeLessThanOrEqual(480);
    }
  });
  it("gives each ring a centre one pitch from the last", () => {
    const l = loopLayout(5);
    expect(ringCentre(l, 1) - ringCentre(l, 0)).toBe(l.pitch);
  });
  it("has a lane for the baton above the rings and room for two lines of label below them", () => {
    for (const n of COUNTS) {
      const l = loopLayout(n);
      expect(l.height).toBe(l.lane + l.ring + l.labels);
      expect(l.lane).toBeGreaterThanOrEqual(20);
      expect(l.labels).toBeGreaterThanOrEqual(36);
    }
  });
});

describe("castHeight: the space the preview always keeps", () => {
  it("is as tall as the tallest figure of any mode and count, plus its caption, so nothing below it moves when the mode or count changes", () => {
    const tallest = Math.max(...COUNTS.flatMap((n) => [battleLayout(n).height, loopLayout(n).height]));
    expect(stageHeight()).toBe(tallest);
    expect(castHeight()).toBe(tallest + CAPTION_H);
    for (const n of COUNTS) {
      expect(castHeight()).toBeGreaterThanOrEqual(battleLayout(n).height + CAPTION_H);
      expect(castHeight()).toBeGreaterThanOrEqual(loopLayout(n).height + CAPTION_H);
    }
  });
});

describe("roundLook: one round goes aim, spin, mark, and then stays as it was left", () => {
  for (const n of COUNTS) {
    const p = loopPreview(n);
    const tape = loopTape(p);
    const looks = (round: number) => tape.map((b) => roundLook(b, round, p.bestRound));
    const rounds = p.rounds.map((r) => r.round);
    describe(`${n} rounds`, () => {
      it("draws a ring on the spin and never takes it away", () => {
        for (const r of rounds) {
          const drawn = looks(r).map((x) => x.drawn);
          expect(drawn).toEqual([...drawn].sort((a, b) => Number(a) - Number(b)));
          const spin = tape.findIndex((b) => b.kind === "spin" && b.round === r);
          expect(drawn[spin]).toBe(true);
          expect(drawn[spin - 1]).toBe(false);
        }
      });
      it("turns one orb at a time, and only in a spin beat", () => {
        tape.forEach((b) => {
          const turning = rounds.filter((r) => roundLook(b, r, p.bestRound).spinning);
          expect(turning).toEqual(b.kind === "spin" ? [b.round] : []);
        });
      });
      it("pulses the aimed part of a ring when it is aimed, and its weakest part when that is marked, and at no other time", () => {
        tape.forEach((b) => {
          for (const r of rounds) {
            const pulse = roundLook(b, r, p.bestRound).pulse;
            expect(pulse).toBe(b.round === r && b.kind === "aim" ? "aimed" : b.round === r && b.kind === "mark" ? "weakest" : null);
          }
        });
      });
      it("marks a weakest part only on a ring that is drawn, and keeps it", () => {
        for (const r of rounds) {
          const seen = looks(r);
          seen.forEach((x) => { if (x.marked) expect(x.drawn).toBe(true); });
          const marks = seen.map((x) => x.marked);
          expect(marks).toEqual([...marks].sort((a, b) => Number(a) - Number(b)));
        }
      });
      it("has every ring drawn, aimed and marked at the end, with exactly the best round crowned", () => {
        const last = tape.at(-1)!;
        for (const r of rounds) {
          const x = roundLook(last, r, p.bestRound);
          expect([x.drawn, x.aimed, x.marked, x.pulse]).toEqual([true, true, true, null]);
          expect(x.crowned).toBe(r === p.bestRound);
          expect(x.spent).toBe(r > p.bestRound);
        }
      });
      it("crowns nothing before the end", () => {
        for (const b of tape.filter((x) => x.kind !== "crown" && x.kind !== "rest")) for (const r of rounds) expect(roundLook(b, r, p.bestRound)).toMatchObject({ crowned: false, spent: false });
      });
    });
  }
  it("leaves round 6 spent when it did not beat round 5, and nothing spent when the last round is the best", () => {
    const [six, five] = [loopPreview(6), loopPreview(5)];
    expect(roundLook(loopTape(six).at(-1)!, 6, six.bestRound).spent).toBe(true);
    expect(five.rounds.every((r) => !roundLook(loopTape(five).at(-1)!, r.round, five.bestRound).spent)).toBe(true);
  });
  it("puts the mark for the last round's value on a ring from the moment it is aimed", () => {
    const tape = loopTape(loopPreview(4));
    const iAim = tape.findIndex((b) => b.kind === "aim" && b.round === 3);
    expect(roundLook(tape[iAim - 1], 3, 4).aimed).toBe(false);
    expect(roundLook(tape[iAim], 3, 4).aimed).toBe(true);
    expect(roundLook(tape[iAim], 3, 4).drawn).toBe(false);
  });
});

describe("filling a part of the ring", () => {
  it("fills in proportion to the measure: 0 draws nothing, 10 draws all of it, and a silly value is held to that", () => {
    expect([0, 5, 10].map(fillOffset)).toEqual([1, 0.5, 0]);
    expect(fillOffset(-3)).toBe(1);
    expect(fillOffset(14)).toBe(0);
  });
  it("puts the end of the fill, and the mark for a value, at the matching angle inside the part", () => {
    const s = segments();
    expect(valueAngle(0, 0)).toBe(s[0].from);
    expect(valueAngle(0, 10)).toBe(s[0].to);
    expect(valueAngle(2, 5)).toBeCloseTo((s[2].from + s[2].to) / 2, 8);
    for (let part = 0; part < 5; part++) expect(valueAngle(part, 7)).toBeGreaterThan(valueAngle(part, 4));
  });
  it("draws the mark as a short line across the ring", () => {
    expect(tickPath(20, 10, 0, 4)).toBe("M 20.00 14.00 L 20.00 6.00");
  });
});

describe("baton: it carries the weakest measure from one round to the next", () => {
  for (const n of [3, 5]) {
    const p = loopPreview(n);
    const weakestOf = (r: number) => p.rounds[r - 1].weakest;
    const tape = loopTape(p);
    it(`${n} rounds: it is only ever on the orb that was just marked or is about to be aimed, and never while an orb spins`, () => {
      for (const b of tape) {
        const at = baton(b, weakestOf);
        if (b.kind === "spin" || b.kind === "gather" || b.kind === "crown" || b.kind === "rest") expect(at.at).toBeNull();
        if (b.kind === "mark") expect(at).toEqual({ at: b.round! - 1, carries: null });
        if (b.kind === "pass") expect(at).toEqual({ at: b.round, carries: weakestOf(b.round!) });
        if (b.kind === "aim") expect(at).toEqual({ at: b.round! - 1, carries: weakestOf(b.round! - 1) });
      }
    });
    it(`${n} rounds: what it carries is what the next round is aimed at`, () => {
      for (const b of tape.filter((x) => x.kind === "aim")) expect(baton(b, weakestOf).carries).toBe(p.rounds[b.round! - 1].aimed);
    });
  }
});

describe("the five-part ring", () => {
  it("has five parts that do not overlap and leave a small gap between neighbours", () => {
    const s = segments();
    expect(s).toHaveLength(DIMENSIONS.length);
    for (let i = 1; i < s.length; i++) expect(s[i].from - s[i - 1].to).toBeCloseTo(12, 5);
    expect(s[0].from).toBeGreaterThan(0);
    expect(s.at(-1)!.to).toBeLessThan(360);
  });
  it("finds points on the circle: the top, the right, the bottom", () => {
    const [top, right, bottom] = [polar(20, 10, 0), polar(20, 10, 90), polar(20, 10, 180)];
    expect([top.x, top.y]).toEqual([20, 10]);
    expect(right.x).toBeCloseTo(30, 5);
    expect(right.y).toBeCloseTo(20, 5);
    expect(bottom.x).toBeCloseTo(20, 5);
    expect(bottom.y).toBeCloseTo(30, 5);
  });
  it("draws an arc from the top, clockwise", () => {
    const d = arcPath(20, 10, 0, 90);
    expect(d).toBe("M 20.00 10.00 A 10 10 0 0 1 30.00 20.00");
  });
});

describe("heroTitle and heroLine: the words over and under the preview", () => {
  const m = (kind: "chat" | "battle" | "loop", n: number) => ({ kind, n, plan: "auto" as const });
  it("is UltraPal (one agent) in chat, and UltraPals (the team) with the mode's name in Battle and Loop", () => {
    expect(heroTitle(m("chat", 4), "UltraPal")).toBe("UltraPal");
    expect(heroTitle(m("battle", 4), "UltraPal")).toBe("UltraPals Battle");
    expect(heroTitle(m("loop", 5), "UltraPal")).toBe("UltraPals Loop");
  });
  it("is the normal line in chat", () => {
    expect(heroLine(m("chat", 4), "normal")).toBe("normal");
  });
  it("says in a Battle how many teams argue and what the knockout looks like for that many", () => {
    expect(heroLine(m("battle", 4), "x")).toBe("4 teams argue opposite predictions, then a knockout picks the best-supported one: semi-finals, a third-place match and a final.");
    expect(heroLine(m("battle", 2), "x")).toMatch(/^2 teams argue .*: a head-to-head final\.$/);
    expect(heroLine(m("battle", 6), "x")).toMatch(/^6 teams argue .*: quarter-finals with 2 byes/);
  });
  it("says in a Loop how many rounds it may run, and that it can stop early", () => {
    expect(heroLine(m("loop", 5), "x")).toBe("One team per round on a new scenario, up to 5 rounds, stops early once it stops improving.");
    expect(heroLine(m("loop", 2), "x")).toBe("One team per round on a new scenario: the base case, then one test.");
  });
  it("changes with the count, so the number picked is always reflected", () => {
    for (const kind of ["battle", "loop"] as const) expect(new Set(COUNTS.map((n) => heroLine(m(kind, n), "x"))).size).toBe(COUNTS.length);
  });
});
