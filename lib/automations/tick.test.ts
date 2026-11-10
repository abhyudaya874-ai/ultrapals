import { afterEach, describe, expect, it } from "vitest";
import { mkDeps, mkSession, scripted } from "@/lib/computer/fakes";
import { Spec } from "./core";
import { createStore, type StoreIO } from "./store";
import { execute, runningNow, startNow, tickDue, type TickDeps } from "./tick";

const memory = (): StoreIO => { let t: string | null = null; return { read: async () => t, write: async (x) => { t = x; } }; };
const spec = (name: string, o: Partial<Spec> = {}) => Spec.parse({ name, prompt: "Summarise the news", schedule: { kind: "every", minutes: 60 }, ...o });
const HOUR = 3_600_000;

function setup(replies: string[] = ['{"action":"answer","text":"All quiet."}'], clock = { t: 0 }) {
  const model = scripted(replies);
  const closed: string[] = [];
  let n = 0;
  const store = createStore(memory(), () => `a${++n}`);
  const t: TickDeps = { deps: mkDeps(model.open), now: () => clock.t, id: () => `run-${clock.t}`, open: () => mkSession({ id: `s${clock.t}`, vm: null }), close: async (s) => { closed.push(s.id); }, store };
  return { t, store, model, closed, clock };
}
afterEach(() => { expect(runningNow()).toBeNull(); }); // no test may leave the process lock held

describe("execute", () => {
  it("runs, stores the run, moves the next run forward and frees the claim", async () => {
    const { t, store, clock } = setup();
    await store.create(spec("Digest"), 0);
    clock.t = HOUR;
    const r = await execute("a1", t);
    expect(r).toMatchObject({ ok: true, run: { status: "ok", answer: "All quiet." } });
    const a = (await store.get("a1"))!;
    expect(a).toMatchObject({ runningSince: undefined, lastRunMs: HOUR, nextRunMs: 2 * HOUR });
    expect(a.runs).toHaveLength(1);
  });
  it("a failed run is stored as a failed run and the automation keeps its schedule", async () => {
    const { t, store, clock } = setup();
    t.deps = mkDeps((async () => ({ ok: false, degraded: true, reason: "http 500" })) as never);
    await store.create(spec("Digest"), 0);
    clock.t = HOUR;
    const r = await execute("a1", t);
    expect(r).toMatchObject({ ok: true, run: { status: "error" } });
    expect((await store.get("a1"))).toMatchObject({ runningSince: undefined, nextRunMs: 2 * HOUR });
  });
  it("releases the claim even if the runner itself throws", async () => {
    const { t, store } = setup();
    await store.create(spec("Digest"), 0);
    t.open = () => { throw new Error("no sessions left"); };
    const r = await execute("a1", t);
    expect(r).toMatchObject({ ok: true, run: { status: "error", error: "no sessions left" } });
    expect((await store.get("a1"))?.runningSince).toBeUndefined();
  });
  it("refuses an unknown id and a paused-by-cap one without running anything", async () => {
    const { t, store, model } = setup();
    expect(await execute("nope", t)).toEqual({ ok: false, why: "no such automation" });
    await store.create(spec("Digest"), 0);
    for (let i = 0; i < 12; i++) { await store.claim("a1", i); await store.finish("a1", { id: "r", atMs: i, ms: 1, status: "ok", answer: "", agents: [], files: [], sources: [] }, i); }
    expect(await execute("a1", t)).toMatchObject({ ok: false, why: expect.stringContaining("12 times") });
    expect(model.calls()).toBe(0);
  });
  it("two runs at once: the second is told to wait", async () => {
    const { t, store } = setup();
    await store.create(spec("A"), 0);
    await store.create(spec("B"), 0);
    const [x, y] = await Promise.all([execute("a1", t), execute("a2", t)]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ why: expect.stringContaining("another automation is running") });
  });
});

describe("tickDue", () => {
  it("does nothing before anything is due", async () => {
    const { t, store, model, clock } = setup();
    await store.create(spec("Digest"), 0);
    clock.t = HOUR - 1;
    expect(await tickDue(t)).toEqual({ ran: null });
    expect(model.calls()).toBe(0);
  });
  it("runs the most overdue one first, one per tick, and skips paused ones", async () => {
    const { t, store, clock } = setup();
    await store.create(spec("Late", { schedule: { kind: "every", minutes: 60 } }), 0);
    await store.create(spec("Later", { schedule: { kind: "every", minutes: 120 } }), 0);
    await store.create(spec("Paused", { enabled: false }), 0);
    clock.t = 5 * HOUR;
    expect(await tickDue(t)).toEqual({ ran: "a1" });
    expect(await tickDue(t)).toEqual({ ran: "a2" }); // a1 moved to 6h, so a2 is next
    expect(await tickDue(t)).toEqual({ ran: null });
    expect((await store.get("a3"))?.runs).toEqual([]);
  });
  it("after the server was off for days it runs once, not once per missed interval", async () => {
    const { t, store, clock } = setup();
    await store.create(spec("Digest"), 0);
    clock.t = 100 * HOUR;
    await tickDue(t);
    expect(await tickDue(t)).toEqual({ ran: null });
    expect((await store.get("a1"))?.runs).toHaveLength(1);
  });
});

describe("startNow", () => {
  it("returns at once and the run finishes in the background", async () => {
    const { t, store, clock } = setup();
    await store.create(spec("Digest"), 0);
    clock.t = 10;
    expect(await startNow("a1", t)).toEqual({ ok: true, id: "a1" });
    for (let i = 0; i < 50 && (await store.get("a1"))!.runs.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await store.get("a1"))!.runs).toHaveLength(1);
  });
  it("an unknown id is refused", async () => expect(await startNow("zzz", setup().t)).toEqual({ ok: false, why: "no such automation" }));
});
