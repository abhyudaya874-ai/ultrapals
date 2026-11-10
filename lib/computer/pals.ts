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
  situation: "SituationPal",
  sandbox: "SandboxPal",
};

/** Display names of the app screens UltraPal can open as artifacts. */
export const APP_TITLES = { newsroom: "Newsroom", dashboard: "Dashboard", timeline: "Timeline", proctor: "Proctor" } as const;

const RAIL_PAL: Record<string, string> = { paypal: "PayPalPal", x402: "X402Pal", apple: "ApplePal" };
const railPal = (slug: string): string => RAIL_PAL[slug] ?? `${slug.replace(/^./, (c) => c.toUpperCase())}Pal`;
const isRole = (s: string): s is AgentRole => s in PAL_NAMES;

/** Pure. "main" -> UltraPal, "research-3" -> ResearchPal; an unknown id falls back to a capitalised id so nothing renders blank. */
export function palName(id: string): string {
  if (id.startsWith("superpal-")) return railPal(id.slice(9)); // superpal-stripe -> StripePal
  if (id.startsWith("sandbox-")) return "SandboxPal";
  if (id.startsWith("research-")) return "ResearchPal";
  const role = id.replace(/-\d+$/, "");
  return isRole(role) ? PAL_NAMES[role] : role.replace(/^./, (c) => c.toUpperCase());
}
