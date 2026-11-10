import { subagents, type AgentRow, type Run } from "./run";

/** Pure. The one-line label of the collapsed Process row, computed from what really happened: "Ran commands, ran subagents, received messages". */
export function processLabel(run: Run): string {
  const subs = subagents(run);
  const parts: string[] = [];
  if (subs.some((a) => a.terms.length > 0)) parts.push("ran commands");
  if (subs.some((a) => a.files.length > 0)) parts.push("edited files");
  if (subs.length > 0) parts.push(subs.length === 1 ? "ran a subagent" : "ran subagents");
  if (run.messages.some((m) => m.from !== "main")) parts.push("received messages");
  if (run.spawns.some((s) => s.decision === "denied")) parts.push("declined some spawns");
  if (parts.length === 0) return "Worked";
  const text = parts.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

export interface DisclosureRow {
  agent: AgentRow;
  depth: 0 | 1 | 2;
}

/**
 * Pure. Subagent rows in thread order with their children right under them, indented at most 2 levels. A row whose parent has
 * not arrived (or never will) is still shown, one level in: ordering never drops work. The main agent is the narrator, not a row.
 */
export function disclosureRows(run: Run): DisclosureRow[] {
  const subs = subagents(run);
  const order = new Map(run.timeline.flatMap((t, i) => (t.t === "agent" ? [[t.id, i] as const] : [])));
  const known = new Set(subs.map((a) => a.id));
  const rank = (a: AgentRow) => order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...subs].sort((a, b) => rank(a) - rank(b));
  const out: DisclosureRow[] = [];
  const seen = new Set<string>();
  const walk = (a: AgentRow, depth: number): void => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push({ agent: a, depth: Math.min(depth, 2) as 0 | 1 | 2 });
    for (const c of sorted) if (c.parent === a.id) walk(c, depth + 1);
  };
  for (const a of sorted) {
    const p = a.parent;
    if (!p || p === "main") walk(a, 0);
    else if (!known.has(p)) walk(a, 1);
  }
  for (const a of sorted) walk(a, 1); // a parent cycle or other oddity: still shown
  return out;
}
