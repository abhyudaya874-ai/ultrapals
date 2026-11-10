import { describe, expect, it } from "vitest";
import { BudgetNode } from "./budget";
import { admitSpawn, ancestors } from "./policy";
import { POLICY, SpawnRequest, attenuate, jobKey, type Caps, type TreeNode, type TreeView } from "./types";

const T0 = 1_000_000;
const ROOT_CAPS: Caps = { spawn: ["pal"], tools: ["llm"], maxCalls: 60, maxMs: 280_000 };
const PAL_CAPS: Caps = { spawn: ["research", "browser", "terminal", "observe"], tools: ["tavily", "exa", "fetch", "render", "term", "llm"], maxCalls: 40, maxMs: 200_000 };
const node = (o: Partial<TreeNode> & { id: string }): TreeNode => ({ parent: null, kind: "root", mode: "script", key: o.id, depth: 0, caps: ROOT_CAPS, callsLeft: 60, deadlineMs: T0 + 280_000, state: "live", ...o });
const tree = (...extra: TreeNode[]): TreeView => ({ nodes: [node({ id: "root" }), node({ id: "pal", parent: "root", kind: "pal", depth: 1, caps: PAL_CAPS, callsLeft: 20 }), ...extra] });
const req = (o: Partial<SpawnRequest> = {}): SpawnRequest => ({ kind: "research", mode: "script", task: "find refund policy", why: "need evidence", input: { q: "a" }, ask: { calls: 0, ms: 5000 }, expects: "sources", ...o });

describe("admitSpawn (T1-T4)", () => {
  it("admits a scripted research worker under a pal", () => expect(admitSpawn(tree(), "pal", req(), T0)).toEqual({ ok: true }));
  it("a spawn without a reason is denied", () => expect(admitSpawn(tree(), "pal", req({ why: "  " }), T0)).toEqual({ ok: false, why: "no_reason" }));
  it("an unknown parent is denied", () => expect(admitSpawn(tree(), "ghost", req(), T0)).toEqual({ ok: false, why: "unknown_parent" }));
  it("T2: a research worker cannot spawn anything, and a root cannot spawn a worker directly", () => {
    const t = tree(node({ id: "r1", parent: "pal", kind: "research", depth: 2, caps: { spawn: [], tools: ["tavily"], maxCalls: 5, maxMs: 1 } }));
    expect(admitSpawn(t, "r1", req({ kind: "terminal", task: "x" }), T0)).toEqual({ ok: false, why: "privilege" });
    expect(admitSpawn(t, "root", req(), T0)).toEqual({ ok: false, why: "privilege" });
  });
  it("a loop worker needs the llm tool on its parent", () => {
    const noLlm = { ...tree(), nodes: tree().nodes.map((n) => (n.id === "pal" ? { ...n, caps: { ...n.caps, tools: ["tavily"] as const } } : n)) };
    expect(admitSpawn(noLlm, "pal", req({ mode: "loop", ask: { calls: 3, ms: 5000 } }), T0)).toEqual({ ok: false, why: "privilege" });
  });
  it("T4: an identical job is joined, not paid for twice (also when finished; not when failed)", () => {
    const done = tree(node({ id: "r1", parent: "pal", kind: "research", depth: 2, key: jobKey(req()), state: "done" }));
    expect(admitSpawn(done, "pal", req(), T0)).toEqual({ ok: true, reuse: "r1" });
    const failed = tree(node({ id: "r1", parent: "pal", kind: "research", depth: 2, key: jobKey(req()), state: "failed" }));
    expect(admitSpawn(failed, "pal", req(), T0)).toEqual({ ok: true });
  });
  it("jobKey ignores key order and case/space in the task", () => {
    expect(jobKey(req({ input: { a: 1, b: 2 }, task: " Find X " }))).toBe(jobKey(req({ input: { b: 2, a: 1 }, task: "find x" })));
  });
  it("a child cannot ask for its own ancestor's job", () => {
    const loopKey = jobKey(req({ kind: "browser", task: "loop" }));
    const t = tree(node({ id: "b1", parent: "pal", kind: "browser", mode: "script", depth: 2, key: loopKey, state: "failed", caps: { spawn: ["research"], tools: ["tavily"], maxCalls: 5, maxMs: 1 } }));
    expect(admitSpawn(t, "b1", req({ kind: "research", task: "other" }), T0)).toEqual({ ok: true });
    const t2 = { nodes: t.nodes.map((n) => (n.id === "b1" ? { ...n, key: jobKey(req({ kind: "research", task: "other" })), state: "live" as const } : n)) };
    expect(admitSpawn(t2, "b1", req({ kind: "research", task: "other" }), T0)).toEqual({ ok: true, reuse: "b1" });
    expect(ancestors(t2, "b1").map((n) => n.id)).toEqual(["b1", "pal", "root"]);
  });
  it("T1: depth, fan-out and node caps hold", () => {
    expect(admitSpawn(tree(node({ id: "deep", parent: "pal", kind: "browser", depth: POLICY.maxDepth, caps: { ...PAL_CAPS, spawn: ["research"] } })), "deep", req({ task: "z" }), T0)).toEqual({ ok: false, why: "depth" });
    const kids = Array.from({ length: POLICY.maxFanout }, (_, i) => node({ id: `k${i}`, parent: "pal", kind: "research", depth: 2, key: `k${i}` }));
    expect(admitSpawn(tree(...kids), "pal", req({ task: "fresh" }), T0)).toEqual({ ok: false, why: "fanout" });
    const many = Array.from({ length: POLICY.maxNodes }, (_, i) => node({ id: `n${i}`, parent: "root", kind: "pal", depth: 1, key: `n${i}` }));
    expect(admitSpawn({ nodes: [...tree().nodes, ...many] }, "pal", req({ task: "fresh" }), T0)).toEqual({ ok: false, why: "nodes" });
  });
  it("property: no sequence of admitted spawns exceeds maxNodes or maxDepth", () => {
    let t = tree();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const kinds = ["pal", "research", "browser", "terminal", "observe"] as const;
    for (let i = 0; i < 400; i++) {
      const parent = t.nodes[Math.floor(rnd() * t.nodes.length)];
      const r = req({ kind: kinds[Math.floor(rnd() * kinds.length)], task: `t${i}`, mode: rnd() < 0.3 ? "loop" : "script", ask: { calls: 1, ms: 5000 } });
      const d = admitSpawn(t, parent.id, r, T0);
      if (d.ok && !d.reuse) t = { nodes: [...t.nodes, node({ id: `x${i}`, parent: parent.id, kind: r.kind, mode: r.mode, key: jobKey(r), depth: parent.depth + 1, caps: attenuate(parent.caps, {}), callsLeft: 5 })] };
    }
    expect(t.nodes.length).toBeLessThanOrEqual(POLICY.maxNodes);
    expect(Math.max(...t.nodes.map((n) => n.depth))).toBeLessThanOrEqual(POLICY.maxDepth);
    expect(t.nodes.filter((n) => n.mode === "loop").length).toBeLessThanOrEqual(POLICY.maxLoopNodes);
  });
  it("loop workers are capped, and a live-loop cap applies", () => {
    const live = Array.from({ length: POLICY.maxLoopLive }, (_, i) => node({ id: `l${i}`, parent: "pal", kind: "research", mode: "loop", depth: 2, key: `l${i}` }));
    expect(admitSpawn(tree(...live), "pal", req({ mode: "loop", task: "more", ask: { calls: 1, ms: 5000 } }), T0)).toEqual({ ok: false, why: "loop_cap" });
  });
  it("budget share: a child may ask at most half the parent's remaining calls; script workers cost 0", () => {
    expect(admitSpawn(tree(), "pal", req({ mode: "loop", ask: { calls: 11, ms: 5000 } }), T0)).toEqual({ ok: false, why: "budget" });
    expect(admitSpawn(tree(), "pal", req({ mode: "loop", ask: { calls: 10, ms: 5000 } }), T0)).toEqual({ ok: true });
    expect(admitSpawn(tree(), "pal", req({ mode: "script", ask: { calls: 12, ms: 5000 } }), T0)).toEqual({ ok: true });
  });
  it("deadline: no spawn into a window with under one second left", () => {
    expect(admitSpawn(tree(), "pal", req(), T0 + 280_000 - 500)).toEqual({ ok: false, why: "deadline" });
  });
  it("is deterministic", () => expect(admitSpawn(tree(), "pal", req(), T0)).toEqual(admitSpawn(tree(), "pal", req(), T0)));
});

describe("attenuate (T2)", () => {
  it("a hostile request for llm + term under a research-only parent gets neither", () => {
    const c = attenuate({ spawn: [], tools: ["tavily"], maxCalls: 3, maxMs: 1000 }, { tools: ["llm", "term", "tavily"], spawn: ["pal"], maxCalls: 99, maxMs: 99_999 });
    expect(c).toEqual({ spawn: [], tools: ["tavily"], maxCalls: 3, maxMs: 1000 });
  });
});

describe("BudgetNode (T11)", () => {
  it("a child reserves from its parent and cannot take more than is left", () => {
    const root = new BudgetNode(10, T0 + 1000);
    root.child(6, T0 + 500);
    expect(root.left).toBe(4);
    expect(() => root.child(5, T0 + 500)).toThrow(RangeError);
  });
  it("unused allowance returns to the parent on release, spent calls stay charged, and a second release is a no-op", () => {
    const root = new BudgetNode(10, T0 + 1000);
    const c = root.child(6, T0 + 500);
    c.tryTake(T0);
    c.tryTake(T0);
    c.release();
    c.release();
    expect(root.left).toBe(8);
    expect(root.spent).toBe(2);
  });
  it("the deadline clamps to the parent's, and spending stops at it", () => {
    const root = new BudgetNode(10, T0 + 100);
    const c = root.child(2, T0 + 9999);
    expect(c.deadlineMs).toBe(T0 + 100);
    expect(c.tryTake(T0 + 100)).toBe(false);
  });
  it("a node cannot spend calls it handed to a child", () => {
    const root = new BudgetNode(3, T0 + 1000);
    root.child(3, T0 + 1000);
    expect(root.tryTake(T0)).toBe(false);
  });
  it("property: Σ spent never exceeds the root's calls, whatever the order of operations", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const root = new BudgetNode(25, T0 + 10_000);
    const live: BudgetNode[] = [root];
    for (let i = 0; i < 600; i++) {
      const n = live[Math.floor(rnd() * live.length)];
      const r = rnd();
      if (r < 0.45) n.tryTake(T0);
      else if (r < 0.7) { try { live.push(n.child(Math.floor(rnd() * 5), T0 + 5000)); } catch { /* did not fit */ } }
      else if (n !== root) { n.release(); live.splice(live.indexOf(n), 1); }
      expect(root.spent).toBeLessThanOrEqual(25);
      expect(root.left).toBeGreaterThanOrEqual(0);
    }
  });
});
