import type { ContenderInfo, Tool } from "./types";

export interface Persona {
  id: string;
  name: string;
  blurb: string;
  /** How this contender works. Appended to its instructions. */
  directive: string;
  /** -1 pessimistic .. +1 optimistic. Used to spread the contenders apart. */
  lean: number;
}

/** A closed list: a new persona is a code change with a test, not a model decision. */
export const PERSONAS: Persona[] = [
  { id: "maximalist", name: "Maximalist", lean: 1, blurb: "hunts for the upside", directive: "Look for the best realistic case and the evidence for it. Price in what success would be worth." },
  { id: "pragmatist", name: "Pragmatist", lean: 0.4, blurb: "shortest path that works", directive: "Take the simplest route that works today. Prefer what can be done this week with tools that exist." },
  { id: "creative", name: "Lateral thinker", lean: 0.2, blurb: "tries the unexpected angle", directive: "Look for an angle nobody listed: another audience, another rail, another way to frame the goal. Test it against facts." },
  { id: "rigorist", name: "Rigorist", lean: 0, blurb: "numbers or nothing", directive: "Trust only what you can cite or compute. Do the arithmetic in the terminal and show it. Say 'unknown' where the evidence is missing." },
  { id: "cost", name: "Cost cutter", lean: -0.2, blurb: "minimises spend", directive: "Optimise for total cost over the whole life of the plan, including fees, effort and switching costs." },
  { id: "compliance", name: "Risk officer", lean: -0.6, blurb: "finds what can go wrong", directive: "Look for legal, security, fraud and operational risks, and what a regulator or an auditor would ask." },
  { id: "contrarian", name: "Contrarian", lean: -0.4, blurb: "argues the common view is wrong", directive: "Find the consensus view, then find the strongest evidence against it. Say where the crowd is probably mistaken." },
  { id: "skeptic", name: "Skeptic", lean: -1, blurb: "assumes it fails", directive: "Assume the plan fails and find out why. Look for the failure that would hurt most and the evidence that it is likely." },
];

/** Opposed predictions. Taken in this order, so any two of them already contradict and more only add shades. */
export const STANCES = [
  { id: "up", label: "It works, and better than expected", text: "It succeeds, and the result will beat the usual expectation." },
  { id: "down", label: "It fails or falls short", text: "It fails or falls clearly short of the usual expectation." },
  { id: "if", label: "Only if one condition holds", text: "It works only if one specific condition holds. Name that condition and predict whether it will." },
  { id: "wrong", label: "The common view is wrong", text: "The common expectation is wrong. Predict the outcome that most people would not." },
  { id: "late", label: "Right idea, wrong timing", text: "The idea is sound but the timing is wrong. Predict when it would start to work." },
  { id: "niche", label: "Works for a small group only", text: "It works for a narrow segment and not for the mass market. Name the segment." },
] as const;

const TOOLS: Tool[] = ["research", "terminal", "browser"];
export const TOOL_HINT: Record<Tool, string> = {
  research: "Start with web research (several searches), then browse only where a search result is not enough.",
  terminal: "Start in the terminal: fetch data with curl, compute with node or python, and save a CSV before you search.",
  browser: "Start in the live browser: open the primary sources yourself and read them, then research to fill gaps.",
};

/**
 * Pure. `n` personas spread across the optimistic-to-pessimistic range (the extremes first, then the middle), each with a different stance
 * and a different tool to start with. The same `n` always gives the same line-up, so a battle can be reproduced.
 */
export function lineup(n: number): { persona: Persona; stance: (typeof STANCES)[number]; tool: Tool }[] {
  const count = Number.isFinite(n) ? Math.max(2, Math.min(Math.floor(n), STANCES.length)) : 2; // at most one contender per distinct stance
  const byLean = [...PERSONAS].sort((a, b) => b.lean - a.lean);
  // extremes alternate in, so n = 2 is the most optimistic against the most pessimistic
  const picked: typeof PERSONAS = [];
  let lo = 0;
  let hi = byLean.length - 1;
  while (picked.length < count) {
    picked.push(byLean[lo++]);
    if (picked.length < count) picked.push(byLean[hi--]);
  }
  return picked.map((persona, i) => ({ persona, stance: STANCES[i % STANCES.length], tool: TOOLS[i % TOOLS.length] }));
}

export const contenderInfo = (i: number, l: ReturnType<typeof lineup>[number], model?: string): ContenderInfo => ({
  id: `c${i + 1}-${l.persona.id}`,
  name: l.persona.name,
  persona: l.persona.blurb,
  stance: l.stance.label,
  tool: l.tool,
  ...(model ? { model } : {}),
});
