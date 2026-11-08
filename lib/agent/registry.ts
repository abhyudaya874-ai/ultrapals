import type { AgentProfile, SubagentId } from "./types";

// Hard caps. If a profile needs more, the slice is wrong, not the cap.
export const PROFILES: Record<SubagentId, AgentProfile> = {
  guard:      { id: "guard",      title: "Capture guard",       maxMs: 2500, retries: 0, requiresNetwork: false, onFailure: "abort" },
  observer:   { id: "observer",   title: "Condition observer",  maxMs: 5000, retries: 1, requiresNetwork: true,  onFailure: "degrade" },
  resolver:   { id: "resolver",   title: "Condition resolver",  maxMs: 20000, retries: 0, requiresNetwork: true,  onFailure: "degrade" }, // kernel.observePage spins a cloud browser: ~13-18s cold
  reconciler: { id: "reconciler", title: "Event reconciler",    maxMs: 1000, retries: 0, requiresNetwork: false, onFailure: "ignore" },
  explainer:  { id: "explainer",  title: "Verdict explainer",   maxMs: 4500, retries: 0, requiresNetwork: true,  onFailure: "ignore" },
  nudger:     { id: "nudger",     title: "Friendly nudger",     maxMs: 4000, retries: 0, requiresNetwork: true,  onFailure: "ignore" },
  archivist:  { id: "archivist",  title: "Log archivist",       maxMs: 3500, retries: 0, requiresNetwork: false, onFailure: "ignore" },
};

/**
 * Documentation of the fixed graph. Each inner array runs in parallel; stages run in order.
 * `computeVerdict` + capture happen in app/api/promise/route.ts between stage 3 and 4.
 */
export const GRAPH: readonly (readonly SubagentId[])[] = [
  ["guard"], // 1. load + prove local facts
  ["observer"], // 2. look at PayPal (payment evidence)
  ["resolver"], // 3. look at the world: Channel3 / KERNEL / Astropods / manual snapshot (condition evidence)
  ["reconciler"], // 4. compare local log vs provider (local only)
  // --- route: computeVerdict (pure) -> persist event -> capture (idempotent) ---
  ["explainer", "nudger", "archivist"], // 5. best-effort decoration
];
