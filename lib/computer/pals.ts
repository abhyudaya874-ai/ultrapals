import type { AgentRole } from "./events";

export const APP_NAME = "UltraPals";

/** The one place a role gets its Pal name. Roles and ids in data/events stay canonical; only display uses this. */
export const PAL_NAMES: Record<AgentRole, string> = {
  main: "UltraPal",
  research: "ResearchPal",
  browser: "BrowserPal",
  terminal: "TerminalPal",
  promise: "PromisePal",
  rival: "RivalPal",
  superpal: "SuperPal",
};

const isRole = (s: string): s is AgentRole => s in PAL_NAMES;

/** Pure. "main" -> UltraPal, "research-3" -> ResearchPal; an unknown id falls back to a capitalised id so nothing renders blank. */
export function palName(id: string): string {
  if (id.startsWith("superpal-")) return `${id.slice(9).replace(/^./, (c) => c.toUpperCase())}Pal`; // superpal-stripe -> StripePal
  const role = id.replace(/-\d+$/, "");
  return isRole(role) ? PAL_NAMES[role] : role.replace(/^./, (c) => c.toUpperCase());
}
