import { describe, expect, it } from "vitest";
import { DAILY_RUN_CAP, KEEP_RUNS, MAX_AUTOMATIONS, Spec, type RunSummary } from "./core";
import { createStore, parseDb, type StoreIO } from "./store";

const memory = (initial: string | null = null): StoreIO & { text: () => string | null; writes: () => number } => {
  let t = initial;
  let n = 0;
  return { read: async () => t, write: async (x) => { t = x; n++; }, text: () => t, writes: () => n };
};
const spec = (o: Partial<Spec> = {}): Spec => Spec.parse({ name: "Digest", prompt: "Summarise the news", schedule: { kind: "every", minutes: 60 }, ...o });
const run = (id: string, atMs = 0): RunSummary => ({ id, atMs, ms: 5, status: "ok", answer: "done", agents: ["research"], files: [], sources: [] });
const mk = () => { let n = 0; return createStore(memory(), () => `a${++n}`); };

describe("parseDb", () => {
  it.each([[null], [""], ["not json"], ["[]"], ['{"automations":"x"}']])("%j -> empty", (t) => expect(parseDb(t)).toEqual([]));
  it("drops a broken entry and keeps the rest", () => {
    const store = createStore(memory(), () => "ok1");
    return store.create(spec(), 1000).then(async () => {
      const good = JSON.parse(JSON.stringify({ automations: [{ ...(await store.list())[0] }, { id: "bad", name: "", prompt: "x" }, null] }));
      expect(parseDb(JSON.stringify(good)).map((a) => a.id)).toEqual(["ok1"]);
    });
  });
});

describe("store", () => {
  it("creates, lists, updates and removes", async () => {
    const s = mk();
    const c = await s.create(spec(), 1000);
    expect(c).toMatchObject({ ok: true, automation: { id: "a1", nextRunMs: 1000 + 3_600_000 } });
    expect((await s.list()).map((a) => a.name)).toEqual(["Digest"]);
    const u = await s.update("a1", { name: "Renamed", enabled: false }, 2000);
    expect(u).toMatchObject({ name: "Renamed", enabled: false, nextRunMs: null });
    const back = await s.update("a1", { enabled: true }, 5000);
    expect(back?.nextRunMs).toBe(5000 + 3_600_000);
    expect(await s.remove("a1")).toBe(true);
    expect(await s.remove("a1")).toBe(false);
    expect(await s.list()).toEqual([]);
  });
  it("changing the schedule moves the next run; changing only the name does not", async () => {
    const s = mk();
    await s.create(spec(), 0);
    const named = await s.update("a1", { name: "x" }, 999_000);
    expect(named?.nextRunMs).toBe(3_600_000);
    const sched = await s.update("a1", { schedule: { kind: "every", minutes: 120 } }, 999_000);
    expect(sched?.nextRunMs).toBe(999_000 + 7_200_000);
  });
  it("refuses an invalid update without changing anything", async () => {
    const s = mk();
    await s.create(spec(), 0);
    expect(await s.update("a1", { schedule: { kind: "every", minutes: 5 } }, 0)).toBeNull();
    expect((await s.get("a1"))?.schedule).toEqual({ kind: "every", minutes: 60 });
  });
  it(`allows at most ${MAX_AUTOMATIONS}`, async () => {
    const s = mk();
    for (let i = 0; i < MAX_AUTOMATIONS; i++) expect((await s.create(spec(), 0)).ok).toBe(true);
    expect(await s.create(spec(), 0)).toMatchObject({ ok: false, reason: expect.stringContaining("at most 8") });
  });
  it("a claim marks it running; a second claim is refused until it finishes", async () => {
    const s = mk();
    await s.create(spec(), 0);
    expect(await s.claim("a1", 10)).toMatchObject({ ok: true, automation: { runningSince: 10 } });
    expect(await s.claim("a1", 20)).toEqual({ ok: false, why: "it is already running" });
    const f = await s.finish("a1", run("r1"), 30);
    expect(f).toMatchObject({ runningSince: undefined, lastRunMs: 30, nextRunMs: 30 + 3_600_000 });
    expect((await s.claim("a1", 40)).ok).toBe(true);
  });
  it("two claims fired at once start one run", async () => {
    const s = mk();
    await s.create(spec(), 0);
    const [x, y] = await Promise.all([s.claim("a1", 10), s.claim("a1", 10)]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
  });
  it("claim refuses past the daily cap and for an unknown id", async () => {
    const s = mk();
    await s.create(spec(), 0);
    for (let i = 0; i < DAILY_RUN_CAP; i++) { await s.claim("a1", i); await s.finish("a1", run(`r${i}`), i); }
    expect(await s.claim("a1", 100)).toMatchObject({ ok: false, why: expect.stringContaining("12 times") });
    expect(await s.claim("nope", 1)).toEqual({ ok: false, why: "no such automation" });
  });
  it(`keeps only the newest ${KEEP_RUNS} runs, newest first`, async () => {
    const s = mk();
    await s.create(spec(), 0);
    for (let i = 0; i < KEEP_RUNS + 4; i++) await s.finish("a1", run(`r${i}`, i), i);
    const runs = (await s.get("a1"))!.runs;
    expect(runs).toHaveLength(KEEP_RUNS);
    expect(runs[0].id).toBe(`r${KEEP_RUNS + 3}`);
  });
  it("finishing a paused automation leaves it with no next run", async () => {
    const s = mk();
    await s.create(spec(), 0);
    await s.claim("a1", 1);
    await s.update("a1", { enabled: false }, 2);
    expect((await s.finish("a1", run("r"), 3))?.nextRunMs).toBeNull();
  });
  it("another store on the same file sees the data (two processes)", async () => {
    const io = memory();
    const a = createStore(io, () => "x1");
    const b = createStore(io, () => "x2");
    await a.create(spec(), 0);
    expect((await b.list()).map((x) => x.id)).toEqual(["x1"]);
    expect((await b.claim("x1", 5)).ok).toBe(true);
    expect((await a.claim("x1", 6)).ok).toBe(false);
  });
});
