import { describe, expect, it } from "vitest";
import { createPump } from "./pump";

const instant = () => Promise.resolve();

describe("createPump", () => {
  it("shows a batch in order", async () => {
    const seen: number[] = [];
    const p = createPump<number>((n) => seen.push(n), () => 0, instant);
    p.push([1, 2, 3]);
    await p.idle();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("still shows a later batch after an earlier one that needed no pauses (the bug: the first batch finished before its promise was stored)", async () => {
    const seen: number[] = [];
    const p = createPump<number>((n) => seen.push(n), () => 0, instant);
    p.push([1, 2]);
    p.push([3]);
    p.push([4, 5]);
    await p.idle();
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("pauses between items by the delay it is given, with the number still waiting", async () => {
    const naps: number[] = [];
    const waits: number[] = [];
    const p = createPump<string>(() => undefined, (_, waiting) => { waits.push(waiting); return 50; }, (ms) => { naps.push(ms); return Promise.resolve(); });
    p.push(["a", "b", "c"]);
    await p.idle();
    expect(naps).toEqual([50, 50, 50]);
    expect(waits).toEqual([2, 1, 0]);
  });

  it("takes items pushed while it is waiting, without running twice at once", async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    let active = 0;
    let most = 0;
    const p = createPump<string>((s) => { seen.push(s); active++; most = Math.max(most, active); active--; }, () => 10, () => new Promise<void>((r) => { release = r; }));
    p.push(["a"]);
    expect(seen).toEqual(["a"]);
    p.push(["b"]);
    expect(seen).toEqual(["a"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["a", "b"]);
    release();
    await p.idle();
    expect(most).toBe(1);
  });

  it("hurry shows what is left without waiting", async () => {
    const naps: number[] = [];
    const seen: number[] = [];
    const p = createPump<number>((n) => { seen.push(n); if (n === 1) p.hurry(); }, () => 40, (ms) => { naps.push(ms); return Promise.resolve(); });
    p.push([1, 2, 3, 4]);
    await p.idle();
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(naps).toEqual([]);
  });

  it("a show that throws rejects idle; what was still queued is shown with the next push", async () => {
    const seen: number[] = [];
    const p = createPump<number>((n) => { if (n === 2) throw new Error("boom"); seen.push(n); }, () => 0, instant);
    p.push([1, 2, 3]);
    await expect(p.idle()).rejects.toThrow("boom");
    p.push([4]);
    await p.idle();
    expect(seen).toEqual([1, 3, 4]);
  });

  it("is idle at once when nothing was pushed", async () => {
    await expect(createPump<number>(() => undefined, () => 0, instant).idle()).resolves.toBeUndefined();
  });
});
