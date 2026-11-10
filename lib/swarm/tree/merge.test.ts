import { describe, expect, it } from "vitest";
import { mergeStreams } from "./merge";

const tally = { live: 0, peak: 0 };
async function* task(id: string, steps: number, ms: number, fail = false): AsyncGenerator<string, string> {
  tally.live++;
  tally.peak = Math.max(tally.peak, tally.live);
  try {
    for (let i = 0; i < steps; i++) {
      await new Promise((r) => setTimeout(r, ms));
      yield `${id}${i}`;
    }
    if (fail) throw new Error(`${id} exploded`);
    return `${id} done`;
  } finally {
    tally.live--;
  }
}
async function run<E, R>(g: AsyncGenerator<E, R>) {
  const ev: E[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { ev, ret: n.value };
    ev.push(n.value);
  }
}

describe("mergeStreams", () => {
  it("never has more than n tasks in flight and keeps results in input order", async () => {
    tally.peak = 0;
    const { ret } = await run(mergeStreams(Array.from({ length: 9 }, (_, i) => () => task(`t${i}`, 2, 2)), 4));
    expect(tally.peak).toBe(4);
    expect(ret.map((r) => (r.ok ? r.value : "x"))).toEqual(Array.from({ length: 9 }, (_, i) => `t${i} done`));
  });
  it("streams events interleaved as they arrive, not one task after another", async () => {
    const { ev } = await run(mergeStreams([() => task("a", 3, 6), () => task("b", 3, 6)], 2));
    expect(ev).toHaveLength(6);
    expect(ev.join("").replace(/(.)\d/g, "$1").replace(/(.)\1+/g, "$1").length).toBeGreaterThan(2);
  });
  it("a throwing task is {ok:false}; the others finish", async () => {
    const { ret } = await run(mergeStreams([() => task("good", 1, 1), () => task("bad", 1, 1, true), () => task("also", 1, 1)], 2));
    expect(ret).toEqual([{ ok: true, value: "good done" }, { ok: false, error: "bad exploded" }, { ok: true, value: "also done" }]);
  });
  it("an empty list returns at once; n < 1 throws", async () => {
    expect((await run(mergeStreams([], 3))).ret).toEqual([]);
    await expect(run(mergeStreams([() => task("a", 1, 1)], 0))).rejects.toThrow(RangeError);
  });
  it("a consumer that stops early stops the tasks from pulling more", async () => {
    tally.live = 0;
    const g = mergeStreams(Array.from({ length: 6 }, (_, i) => () => task(`t${i}`, 50, 2)), 2);
    await g.next();
    await g.return(undefined as never);
    await new Promise((r) => setTimeout(r, 40));
    expect(tally.live).toBe(0);
  });
});
