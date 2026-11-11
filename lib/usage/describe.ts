import type { AgentLoad, ToolTally } from "./context";
import type { Ring } from "./rings";
import { formatTokens, percentLabel } from "./tokens";

const agents = (n: number): string => `${n} agent${n === 1 ? "" : "s"}`;

/** Pure. What the tooltip says first: "2% (11.2K / 524K) context used across 3 agents". An estimate is marked with "about". */
export function ringHeadline(r: Ring): string {
  const about = r.started && r.exact ? "" : "about ";
  const across = r.agents.length > 1 ? ` across ${agents(r.agents.length)}` : "";
  return `${about}${percentLabel(r.used, r.window)} (${formatTokens(r.used)} / ${formatTokens(r.window)}) context used${across}`;
}

/** Pure. Where the numbers came from, in a sentence a person can check. */
export function ringSource(r: Ring): string {
  if (!r.started) return "Nothing has been sent yet. This is UltraPal's own instructions, against the smallest window among the models it can use.";
  const n = `${formatTokens(r.prompt)} in, ${formatTokens(r.completion)} out`;
  if (r.live) return `Streaming now: about ${n} so far. Each provider's own count replaces its estimate when its call ends.`;
  return r.exact ? `Counted by the providers: ${n}.` : `Estimated from the text: about ${n}. At least one provider sent no count.`;
}

/** Pure. "12 steps · 3 commands · 2 files · 4 searches · 8 pages · 1 Pal sent out · 2 messages sent", only what the agent did. */
export function toolLine(t: ToolTally): string {
  const parts: [number, string, string][] = [[t.steps, "step", "steps"], [t.commands, "command", "commands"], [t.files, "file", "files"], [t.searches, "search", "searches"], [t.pages, "page", "pages"], [t.spawned, "Pal sent out", "Pals sent out"], [t.messages, "message sent", "messages sent"]];
  return parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(" · ");
}

/** Pure. The one line under a running agent: what it is waiting for, or hearing, or doing. Null when it is idle. */
export function doingLine(a: Pick<AgentLoad, "doing" | "step" | "model">): string | null {
  const model = a.model ? a.model.split("/").pop() : "the model";
  if (a.doing === "waiting") return `Waiting to hear from ${model}`;
  if (a.doing === "writing") return `Hearing ${model}`;
  if (a.doing === "working") return a.step ?? "Working";
  return null;
}
