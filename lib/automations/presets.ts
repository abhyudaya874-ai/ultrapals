import type { Schedule } from "./core";

export const PRESETS = [
  { id: "30m", label: "Every 30 minutes", timed: false },
  { id: "1h", label: "Every hour", timed: false },
  { id: "6h", label: "Every 6 hours", timed: false },
  { id: "12h", label: "Every 12 hours", timed: false },
  { id: "daily", label: "Every day", timed: true },
  { id: "weekdays", label: "Weekdays", timed: true },
  { id: "weekends", label: "Weekends", timed: true },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

const MINUTES: Partial<Record<PresetId, number>> = { "30m": 30, "1h": 60, "6h": 360, "12h": 720 };
const DAYS: Partial<Record<PresetId, number[]>> = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };

/** Pure. The schedule a preset and a "HH:MM" time input stand for. A bad time falls back to 09:00 rather than failing the form. */
export function buildSchedule(preset: PresetId, time: string): Schedule {
  const m = MINUTES[preset];
  if (m !== undefined) return { kind: "every", minutes: m };
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  const hour = t && Number(t[1]) < 24 ? Number(t[1]) : 9;
  const minute = t && Number(t[2]) < 60 ? Number(t[2]) : 0;
  return { kind: "daily", hour, minute, days: DAYS[preset] ?? DAYS.daily! };
}

/** Pure. A first line of the prompt makes a short name. */
export function nameFromPrompt(prompt: string): string {
  const first = prompt.trim().split("\n")[0].replace(/\s+/g, " ");
  return first.length <= 50 ? first : `${first.slice(0, 47).trimEnd()}…`;
}

/** Pure. "in 5 h", "2 min ago", "just now". `now` is a parameter, so the output is reproducible. */
export function relative(ms: number, now: number): string {
  const d = ms - now;
  const a = Math.abs(d);
  if (a < 45_000) return "just now";
  const [n, unit] = a < 3_600_000 ? [Math.round(a / 60_000), "min"] : a < 86_400_000 ? [Math.round(a / 3_600_000), "h"] : [Math.round(a / 86_400_000), "d"];
  return d > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

export const SUGGESTIONS: { title: string; blurb: string; prompt: string; preset: PresetId }[] = [
  { title: "Payment rails watch", blurb: "Re-compare PayPal, Stripe and Square for micro-payments and flag what changed.", prompt: "Compare PayPal, Stripe and Square fees and limits for payments under one dollar. Save the comparison as rails.csv, and say what changed compared with the last run if you can see an earlier rails.csv.", preset: "daily" },
  { title: "Hackathon opportunity tracker", blurb: "Find new hackathons with a payments or agents track and save them as a CSV.", prompt: "Search for hackathons with a payments, fintech or AI-agents track whose deadline is in the next 30 days. Save them as hackathons.csv with name, deadline, prize and link, and summarise the three best fits.", preset: "weekdays" },
  { title: "Sandbox health check", blurb: "Open the Proctor artifact and report any new case or changed check.", prompt: "Open the proctor artifact. Report whether any check changed or any case is open, and name the rail and check. If nothing changed, say so in one line.", preset: "6h" },
];
