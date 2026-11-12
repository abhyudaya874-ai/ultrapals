import { describe, expect, it } from "vitest";
import { MAX_HP } from "./duel";
import { contenderInfo, lineup } from "./personas";
import { defaultPlan } from "./plan";
import { battlePreview, battleTape, clampCount, loopPreview, loopTape, standIn, tapeMs } from "./preview";
import { replay } from "./replay";
import { DIMENSIONS } from "./types";

const COUNTS = [2, 3, 4, 5, 6];

describe("clampCount", () => {
  it("keeps a count inside what the mode menu offers", () => {
    expect([0, 1, 2, 6, 7, 99].map(clampCount)).toEqual([2, 2, 2, 6, 6, 6]);
    expect(clampCount(3.6)).toBe(4);
    expect(clampCount(Number.NaN)).toBe(2);
  });
});

describe("standIn: a repeatable stand-in for a judge's score", () => {
  it("is the same every time and stays between 2.0 and 9.8", () => {
    for (const d of DIMENSIONS) {
      expect(standIn("skeptic", d)).toBe(standIn("skeptic", d));
      expect(standIn("skeptic", d)).toBeGreaterThanOrEqual(2);
      expect(standIn("skeptic", d)).toBeLessThanOrEqual(9.8);
    }
  });
  it("differs between teams and between measures", () => {
    const all = new Set(["skeptic", "maximalist", "pragmatist"].flatMap((t) => DIMENSIONS.map((d) => standIn(t, d))));
    expect(all.size).toBeGreaterThan(10);
  });
  it("gives every team a measure it is clearly best at and one it is clearly worst at", () => {
    for (const team of ["maximalist", "skeptic", "pragmatist", "compliance", "creative", "contrarian"]) {
      const s = DIMENSIONS.map((d) => standIn(team, d));
      expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(4);
    }
  });
});

describe("battlePreview: the real bracket and the real duel, with stand-in scores", () => {
  for (const n of COUNTS) {
    describe(`${n} teams`, () => {
      const p = battlePreview(n);
      it("has exactly n teams, each standing once, in the bracket's own order", () => {
        expect(p.teams).toHaveLength(n);
        expect([...p.order].sort()).toEqual(p.teams.map((t) => t.id).sort());
      });
      it("plays n - 1 matches: every team but the champion loses exactly once", () => {
        expect(p.matches).toHaveLength(n - 1);
        const losers = p.matches.map((m) => m.loser);
        expect(new Set(losers).size).toBe(n - 1);
        expect(losers).not.toContain(p.champion);
        expect(p.matches.at(-1)!.winner).toBe(p.champion);
        expect(p.matches.at(-1)!.label).toBe("Final");
      });
      it("gives byes to as many teams as the bracket has empty places", () => {
        let size = 2;
        while (size < n) size *= 2;
        expect(p.byes).toHaveLength(size - n);
      });
      it("puts the left-hand fighter on the left of the right-hand one, so the lunge goes the right way", () => {
        for (const m of p.matches) expect(p.order.indexOf(m.a)).toBeLessThan(p.order.indexOf(m.b));
      });
      it("scores every match with the real duel: some hits land, the frames are the real replay, and the last frame is the final health", () => {
        for (const m of p.matches) {
          expect(m.duel.hits.length).toBeGreaterThan(0);
          expect(m.frames).toEqual(replay(m.duel));
          expect(m.frames.at(-1)!.hp).toEqual(m.duel.hp);
          expect(m.duel.winner === "a" ? m.a : m.b).toBe(m.winner);
        }
      });
      it("takes visible health off: at least 20 points are dealt in every match, and the loser loses at least 8, so the bars visibly move", () => {
        for (const m of p.matches) {
          expect(m.duel.taken.a + m.duel.taken.b).toBeGreaterThanOrEqual(20);
          expect(m.duel.taken[m.loser === m.a ? "a" : "b"]).toBeGreaterThanOrEqual(8);
        }
      });
      it("trades blows both ways in every match, so it reads as a fight and not a beating", () => {
        for (const m of p.matches) expect(new Set(m.duel.hits.map((h) => h.by)).size).toBe(2);
      });
      it("carries health between rounds: a winner recovers some of what it lost, a loser keeps what it has", () => {
        for (const m of p.matches) {
          const side = m.winner === m.a ? "a" : "b";
          expect(m.hpAfter[m.winner]).toBeGreaterThanOrEqual(m.duel.hp[side]);
          expect(m.hpAfter[m.winner]).toBeLessThanOrEqual(MAX_HP);
          expect(m.hpAfter[m.loser]).toBe(m.duel.hp[side === "a" ? "b" : "a"]);
        }
      });
      it("plays the same way every time", () => {
        expect(JSON.stringify(battlePreview(n))).toBe(JSON.stringify(p));
      });
      it("describes the whole bracket as a tree: the right number of rounds, each team once in the first round, byes with one source", () => {
        let size = 2;
        while (size < n) size *= 2;
        expect(p.tree).toHaveLength(Math.log2(size));
        expect(p.tree.map((r) => r.length)).toEqual(Array.from({ length: p.tree.length }, (_, i) => size / 2 ** (i + 1)));
        const teams = p.tree[0].flatMap((m) => m.from.flatMap((f) => ("team" in f ? [f.team] : [])));
        expect([...teams].sort()).toEqual(p.teams.map((t) => t.id).sort());
        for (const m of p.tree.flat()) expect(m.from).toHaveLength(m.bye ? 1 : 2);
        for (const m of p.tree.slice(1).flat()) expect(m.from.every((f) => "match" in f)).toBe(true);
        expect(p.tree.flat().filter((m) => m.bye)).toHaveLength(p.byes.length);
        expect(p.tree.at(-1)![0].label).toBe("Final");
      });
    });
  }
  it("clamps a silly count rather than failing", () => {
    expect(battlePreview(1).teams).toHaveLength(2);
    expect(battlePreview(40).teams).toHaveLength(6);
  });
  it("adding a team keeps the teams that were already there", () => {
    for (const n of [2, 3, 4, 5]) {
      const small = battlePreview(n).teams.map((t) => t.id);
      const big = battlePreview(n + 1).teams.map((t) => t.id);
      expect(big).toEqual(expect.arrayContaining(small));
    }
  });
  it("adding a team keeps each earlier team's orb, so it keeps its colours and does not pop in again", () => {
    for (const n of [2, 3, 4, 5]) {
      const small = battlePreview(n).teams.map((t) => t.orb);
      expect(battlePreview(n + 1).teams.map((t) => t.orb).slice(0, n)).toEqual(small);
    }
  });
  it("gives each team the orb id and tool the real Battle gives it, so the colours match the real thing", () => {
    for (const n of COUNTS) {
      const real = lineup(n).map((l, i) => ({ orb: contenderInfo(i, l).id, tool: l.tool }));
      expect(battlePreview(n).teams.map((t) => ({ orb: t.orb, tool: t.tool }))).toEqual(real);
    }
  });
});

describe("battleTape: the preview as beats", () => {
  for (const n of COUNTS) {
    const p = battlePreview(n);
    const tape = battleTape(p);
    describe(`${n} teams`, () => {
      it("starts with everyone standing, health full, and ends with only the champion", () => {
        expect(tape[0].kind).toBe("gather");
        expect(tape[0].alive).toHaveLength(n);
        expect(Object.values(tape[0].hp).every((h) => h === MAX_HP)).toBe(true);
        expect(tape.at(-1)!.alive).toEqual([p.champion]);
        expect(tape.at(-2)!.kind).toBe("crown");
      });
      it("has one beat per replay frame, and each match is played with the number still standing that it should be", () => {
        expect(tape.filter((b) => b.kind === "frame")).toHaveLength(p.matches.reduce((t, m) => t + m.frames.length, 0));
        p.matches.forEach((m, i) => {
          const mine = tape.filter((b) => b.match === i);
          expect(mine.length).toBe(m.frames.length);
          // before match i, i teams have been knocked out
          expect(mine.every((b) => b.alive.length === n - i)).toBe(true);
          expect(mine.every((b) => b.alive.includes(m.a) && b.alive.includes(m.b))).toBe(true);
        });
      });
      it("shows the fighters' health from the duel: the exchange starts at what they had and ends at what the duel decided", () => {
        p.matches.forEach((m, i) => {
          const mine = tape.filter((b) => b.match === i);
          expect(mine[0].hp[m.a]).toBe(m.duel.from.a);
          expect(mine[0].hp[m.b]).toBe(m.duel.from.b);
          expect(mine.at(-1)!.hp[m.a]).toBe(m.duel.hp.a);
          expect(mine.at(-1)!.hp[m.b]).toBe(m.duel.hp.b);
        });
      });
      it("keeps every caption to one line", () => {
        for (const b of tape) expect(b.caption.length).toBeLessThanOrEqual(80);
      });
      it("knows which bracket matches are decided: byes from the first beat, each match the moment it ends, and all of them at the crown", () => {
        const byes = p.tree.flat().filter((m) => m.bye);
        expect(Object.keys(tape[0].decided).sort()).toEqual(byes.map((m) => m.id).sort());
        p.matches.forEach((m, i) => {
          const mine = tape.filter((b) => b.match === i);
          expect(mine.slice(0, -1).every((b) => b.decided[m.id] === undefined)).toBe(true);
          expect(mine.at(-1)!.decided[m.id]).toBe(m.winner);
          expect(mine.every((b) => b.live === m.id)).toBe(true);
        });
        const crown = tape.find((b) => b.kind === "crown")!;
        expect(Object.keys(crown.decided)).toHaveLength(p.tree.flat().length);
        expect(crown.decided[p.tree.at(-1)![0].id]).toBe(p.champion);
        expect(tape.filter((b) => b.kind !== "frame").every((b) => b.live === null)).toBe(true);
      });
      it("says in words who hit whom, on what", () => {
        const hit = tape.find((b) => b.frame?.hit);
        expect(hit?.caption).toMatch(/ hits .* on (evidence|consistency|calibration|actionability|fit) \(\d+\.\d\)$/);
      });
      it("plays in a sensible time: long enough to follow, short enough to wait for", () => {
        const ms = tapeMs(tape);
        expect(ms).toBeGreaterThan(3000);
        expect(ms).toBeLessThan(26_000);
      });
    });
  }
});

describe("loopPreview: each round is told to fix the weakest measure of the round before", () => {
  for (const n of COUNTS) {
    describe(`${n} rounds`, () => {
      const p = loopPreview(n);
      it("has exactly n rounds, numbered from 1", () => {
        expect(p.rounds.map((r) => r.round)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      });
      it("aims every round after the first at the previous round's weakest measure", () => {
        expect(p.rounds[0].aimed).toBeNull();
        for (let i = 1; i < n; i++) expect(p.rounds[i].aimed).toBe(p.rounds[i - 1].weakest);
      });
      it("names the lowest measure as the weakest", () => {
        for (const r of p.rounds) expect(r.dims[r.weakest]).toBe(Math.min(...Object.values(r.dims)));
      });
      it("scores each round as the mean of its five measures", () => {
        for (const r of p.rounds) expect(r.score).toBe(Math.round((Object.values(r.dims).reduce((a, b) => a + b, 0) / 5) * 10) / 10);
      });
      it("lifts the measure it was aimed at by more than any other measure rises", () => {
        for (let i = 1; i < n; i++) {
          const [prev, cur] = [p.rounds[i - 1], p.rounds[i]];
          if (n === 6 && cur.round === 6) continue; // the last round of a six-round loop is the one that does not improve
          const rise = (d: (typeof DIMENSIONS)[number]) => cur.dims[d] - prev.dims[d];
          for (const d of DIMENSIONS) if (d !== cur.aimed) expect(rise(cur.aimed!)).toBeGreaterThan(rise(d));
        }
      });
      it("marks exactly one best round, the highest score, and reports each round's change", () => {
        expect(p.rounds.filter((r) => r.best)).toHaveLength(1);
        expect(p.rounds[p.bestRound - 1].best).toBe(true);
        expect(p.rounds[p.bestRound - 1].score).toBe(Math.max(...p.rounds.map((r) => r.score)));
        expect(p.rounds[0].delta).toBeNull();
        for (let i = 1; i < n; i++) expect(p.rounds[i].delta).toBeCloseTo(p.rounds[i].score - p.rounds[i - 1].score, 1);
      });
    });
  }
  it("improves with every round, and slows down", () => {
    const p = loopPreview(5);
    const deltas = p.rounds.slice(1).map((r) => r.delta!);
    expect(deltas.every((d) => d > 0)).toBe(true);
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1]);
  });
  it("chases a different weakness as the earlier ones are fixed", () => {
    expect(new Set(loopPreview(5).rounds.map((r) => r.weakest)).size).toBeGreaterThanOrEqual(3);
  });
  it("gives each round the orb id and tool the real Loop's default plan gives it, so the colours match the real thing", () => {
    for (const n of COUNTS) {
      const slots = defaultPlan("loop", n, { question: "q" }).slots;
      expect(loopPreview(n).rounds.map((r) => ({ orb: r.orb, tool: r.tool }))).toEqual(slots.map((s, i) => ({ orb: `r${i + 1}-${s.persona}`, tool: s.tool })));
    }
  });
  it("shows the stop rule: with six rounds, round 6 does not beat round 5, so the loop stops with round 5 as the best", () => {
    const p = loopPreview(6);
    expect(p.bestRound).toBe(5);
    expect(p.stop).toBe("held");
    expect(p.rounds[4].score).toBeGreaterThanOrEqual(8);
    expect(p.rounds[5].delta!).toBeLessThan(0);
  });
  it("runs out of rounds, rather than stopping, when the last round is the best", () => {
    for (const n of [2, 3, 4, 5]) {
      const p = loopPreview(n);
      expect(p.bestRound).toBe(n);
      expect(p.stop).toBe("limit");
    }
  });
});

describe("loopTape: one orb at a time", () => {
  for (const n of COUNTS) {
    const p = loopPreview(n);
    const tape = loopTape(p);
    describe(`${n} rounds`, () => {
      it("spins each round's orb exactly once, in order, so two orbs never spin together", () => {
        expect(tape.filter((b) => b.kind === "spin").map((b) => b.round)).toEqual(p.rounds.map((r) => r.round));
      });
      it("aims every round after the first before it spins, and passes the baton between rounds only", () => {
        expect(tape.filter((b) => b.kind === "aim").map((b) => b.round)).toEqual(p.rounds.slice(1).map((r) => r.round));
        expect(tape.filter((b) => b.kind === "pass")).toHaveLength(n - 1);
        p.rounds.slice(1).forEach((r) => {
          const iAim = tape.findIndex((b) => b.kind === "aim" && b.round === r.round);
          const iSpin = tape.findIndex((b) => b.kind === "spin" && b.round === r.round);
          expect(iAim).toBeLessThan(iSpin);
          expect(iSpin - iAim).toBe(1);
        });
      });
      it("never draws a ring before its round has spun, never un-draws one, and ends with all of them", () => {
        const drawn = tape.map((b) => b.drawn);
        expect(drawn).toEqual([...drawn].sort((a, b) => a - b));
        expect(drawn.at(-1)).toBe(n);
        for (const b of tape.filter((x) => x.kind === "spin")) expect(b.drawn).toBe(b.round);
      });
      it("ends by crowning the best round", () => {
        expect(tape.at(-2)!.kind).toBe("crown");
        expect(tape.at(-2)!.round).toBe(p.bestRound);
      });
      it("says the same thing while the baton is passed as when the next round is aimed, so the sentence does not flicker", () => {
        tape.forEach((b, i) => { if (b.kind === "pass") expect(tape[i + 1].caption).toBe(b.caption); });
      });
      it("keeps every caption to one line", () => {
        for (const b of tape) expect(b.caption.length).toBeLessThanOrEqual(80);
      });
      it("gives each sentence long enough to read: 150 ms a word, up to a second and a half", () => {
        // a caption stays up from the beat that sets it until the beat that changes it
        let shownMs = 0;
        tape.forEach((b, i) => {
          shownMs += b.ms + b.hold;
          if (i === tape.length - 1 || tape[i + 1].caption !== b.caption) {
            if (b.kind !== "rest") expect(shownMs, b.caption).toBeGreaterThanOrEqual(Math.min(b.caption.split(" ").length * 150, 1500));
            shownMs = 0;
          }
        });
      });
      it("plays in a sensible time", () => {
        expect(tapeMs(tape)).toBeGreaterThan(3000);
        expect(tapeMs(tape)).toBeLessThan(26_000);
      });
    });
  }
  it("says in words what each round is aiming at", () => {
    const aim = loopTape(loopPreview(4)).find((b) => b.kind === "aim");
    expect(aim?.caption).toMatch(/^Round 2 must beat round 1 on (evidence|consistency|calibration|actionability|fit)$/);
  });
});
