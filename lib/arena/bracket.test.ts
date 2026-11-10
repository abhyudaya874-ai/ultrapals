import { describe, expect, it } from "vitest";
import { buildBracket, nextMatch, resolve, seedPositions, standings, type Result } from "./bracket";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe("seedPositions", () => {
  it.each([[2, [1, 2]], [4, [1, 4, 2, 3]], [8, [1, 8, 4, 5, 2, 7, 3, 6]]])("%i", (n, want) => expect(seedPositions(n)).toEqual(want));
  it("seed 1 and seed 2 can only meet in the final", () => {
    const p = seedPositions(8);
    expect(Math.floor(p.indexOf(1) / 2) < 2 && Math.floor(p.indexOf(2) / 2) >= 2).toBe(true);
  });
});

describe("buildBracket", () => {
  it.each([[2, 1, false], [3, 2, false], [4, 2, true], [5, 3, true], [6, 3, true], [8, 3, true]])("%i contenders -> %i rounds, third place %s", (n, rounds, third) => {
    const b = buildBracket(ids(n), "s");
    expect(b.rounds).toHaveLength(rounds);
    expect(b.third !== null).toBe(third);
    expect(new Set(b.seeds).size).toBe(n);
  });
  it("every contender appears exactly once in round one, and byes go to the top seeds", () => {
    const b = buildBracket(ids(6), "s");
    const slots = b.rounds[0].flatMap((m) => [m.a.id, m.b.id]).filter(Boolean);
    expect([...slots].sort()).toEqual(ids(6));
    const byes = b.rounds[0].filter((m) => m.bye);
    expect(byes).toHaveLength(2);
    const byeSeeds = byes.map((m) => ("seed" in m.a.from && m.a.id ? m.a.from.seed : "seed" in m.b.from ? m.b.from.seed : 0)).sort();
    expect(byeSeeds).toEqual([1, 2]);
  });
  it("is the same for the same ids and seed, different order for another seed", () => {
    expect(buildBracket(ids(4), "x")).toEqual(buildBracket(ids(4), "x"));
    const orders = new Set(Array.from({ length: 10 }, (_, i) => buildBracket(ids(4), `s${i}`).seeds.join()));
    expect(orders.size).toBeGreaterThan(1);
  });
  it("labels the rounds", () => {
    expect(buildBracket(ids(8), "s").rounds.map((r) => r[0].label)).toEqual(["Quarter-final", "Semi-final", "Final"]);
    expect(buildBracket(ids(2), "s").rounds[0][0].label).toBe("Final");
  });
});

describe("resolve / nextMatch / standings", () => {
  const b = buildBracket(ids(4), "s");
  const [m1, m2] = b.rounds[0];
  const play = (results: Result[]) => resolve(b, results);
  it("fills later rounds only from results", () => {
    expect(play([]).rounds[1][0].a.id).toBeNull();
    const r = play([{ matchId: m1.id, winner: m1.a.id! }]);
    expect(r.rounds[1][0].a.id).toBe(m1.a.id);
    expect(r.rounds[1][0].b.id).toBeNull();
  });
  it("sends semi-final losers to the third-place match", () => {
    const r = play([{ matchId: m1.id, winner: m1.a.id! }, { matchId: m2.id, winner: m2.b.id! }]);
    expect(r.third!.a.id).toBe(m1.b.id);
    expect(r.third!.b.id).toBe(m2.a.id);
  });
  it("plays in order: round one, then third place, then the final", () => {
    const order: string[] = [];
    const results: Result[] = [];
    for (let m = nextMatch(b, results); m; m = nextMatch(b, results)) { order.push(m.id); results.push({ matchId: m.id, winner: resolve(b, results).rounds.flat().concat(resolve(b, results).third ? [resolve(b, results).third!] : []).find((x) => x.id === m!.id)!.a.id! }); }
    expect(order).toEqual(["r1m1", "r1m2", "third", "r2m1"]);
  });
  it("byes advance by themselves and are never played", () => {
    const b3 = buildBracket(ids(3), "s");
    const first = nextMatch(b3, []);
    expect(first?.bye).toBe(false);
    expect(first?.round).toBe(1);
    const bye = b3.rounds[0].find((m) => m.bye)!;
    expect(resolve(b3, []).rounds[1][0].a.id ?? resolve(b3, []).rounds[1][0].b.id).toBeTruthy();
    expect(bye.a.id === null || bye.b.id === null).toBe(true);
  });
  it("standings: champion, runner-up, third, fourth", () => {
    const r: Result[] = [{ matchId: m1.id, winner: m1.a.id! }, { matchId: m2.id, winner: m2.a.id! }];
    const semis = resolve(b, r);
    r.push({ matchId: "third", winner: semis.third!.a.id! }, { matchId: "r2m1", winner: semis.rounds[1][0].a.id! });
    const s = standings(b, r);
    expect(s[0]).toBe(m1.a.id);
    expect(s[1]).toBe(m2.a.id);
    expect(s[2]).toBe(semis.third!.a.id);
    expect(new Set(s).size).toBe(4);
  });
  it("two contenders: one match decides it", () => {
    const b2 = buildBracket(ids(2), "s");
    const m = b2.rounds[0][0];
    expect(nextMatch(b2, [])?.id).toBe("r1m1");
    expect(nextMatch(b2, [{ matchId: m.id, winner: m.b.id! }])).toBeNull();
    expect(standings(b2, [{ matchId: m.id, winner: m.b.id! }])[0]).toBe(m.b.id);
  });
});
