import { POLICY, SPAWNS, jobKey, type Decision, type SpawnRequest, type TreeNode, type TreeView } from "./types";

const byId = (t: TreeView, id: string): TreeNode | undefined => t.nodes.find((n) => n.id === id);

/** Pure. The chain from a node up to the root, nearest first. */
export function ancestors(t: TreeView, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (let n = byId(t, id); n; n = n.parent ? byId(t, n.parent) : undefined) out.push(n);
  return out;
}

/**
 * Pure. The ONLY place a spawn is allowed or refused. Same tree + request => same decision. Checks, in order:
 * reason, parent, privilege, dedupe (an identical live or finished job is joined, not paid for twice), repeat in the ancestor chain,
 * depth, fan-out, node count, loop caps, budget share, deadline.
 */
export function admitSpawn(tree: TreeView, parentId: string, req: SpawnRequest, nowMs: number): Decision {
  if (!req.why.trim()) return { ok: false, why: "no_reason" };
  const parent = byId(tree, parentId);
  if (!parent) return { ok: false, why: "unknown_parent" };
  if (!parent.caps.spawn.includes(req.kind) || !SPAWNS[parent.kind].includes(req.kind)) return { ok: false, why: "privilege" };

  const key = jobKey(req);
  const twin = tree.nodes.find((n) => n.key === key && n.state !== "failed");
  if (twin) return { ok: true, reuse: twin.id };
  if (ancestors(tree, parentId).some((n) => n.key === key)) return { ok: false, why: "repeat" };

  if (parent.depth + 1 > POLICY.maxDepth) return { ok: false, why: "depth" };
  if (tree.nodes.filter((n) => n.parent === parentId).length >= POLICY.maxFanout) return { ok: false, why: "fanout" };
  if (tree.nodes.length >= POLICY.maxNodes) return { ok: false, why: "nodes" };

  if (req.mode === "loop") {
    const loops = tree.nodes.filter((n) => n.mode === "loop");
    if (loops.length >= POLICY.maxLoopNodes || loops.filter((n) => n.state === "live").length >= POLICY.maxLoopLive) return { ok: false, why: "loop_cap" };
    if (!parent.caps.tools.includes("llm")) return { ok: false, why: "privilege" };
  }
  const calls = req.mode === "script" ? 0 : req.ask.calls;
  if (calls > Math.floor(parent.callsLeft * POLICY.askShare) && calls > 0) return { ok: false, why: "budget" };
  if (calls > parent.caps.maxCalls) return { ok: false, why: "budget" };
  if (nowMs >= parent.deadlineMs || nowMs + 1000 > parent.deadlineMs) return { ok: false, why: "deadline" };
  return { ok: true };
}
