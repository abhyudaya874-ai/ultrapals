import { LENSES } from "./frame";
import { PERSONAS, STANCES } from "./personas";
import { MAX_SLOTS, MIN_SLOTS, Plan, planProblems, type Slot } from "./plan";
import type { Tool } from "./types";

/** Pure editing of a plan in the review step. Each function returns a new plan and never one that breaks the slot limits. */
export const updateSlot = (plan: Plan, i: number, patch: Partial<Slot>): Plan => ({ ...plan, slots: plan.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
export const canAdd = (plan: Plan): boolean => plan.slots.length < MAX_SLOTS;
export const canRemove = (plan: Plan): boolean => plan.slots.length > MIN_SLOTS;
export const removeSlot = (plan: Plan, i: number): Plan => (canRemove(plan) ? { ...plan, slots: plan.slots.filter((_, k) => k !== i) } : plan);

const TOOLS: Tool[] = ["research", "terminal", "browser"];

/** Pure. One more team or round, filled with the next persona, stance or lens not used yet, so the plan stays valid. */
export function addSlot(plan: Plan): Plan {
  if (!canAdd(plan)) return plan;
  const n = plan.slots.length;
  const tool = TOOLS[n % TOOLS.length];
  if (plan.kind === "battle") {
    const used = new Set(plan.slots.map((s) => s.persona));
    const persona = (PERSONAS.find((p) => !used.has(p.id)) ?? PERSONAS[0]).id;
    const taken = new Set(plan.slots.map((s) => s.stance?.label));
    const stance = STANCES.find((s) => !taken.has(s.label)) ?? STANCES[n % STANCES.length];
    return { ...plan, slots: [...plan.slots, { persona, tool, stance: { label: stance.label, text: stance.text }, scenario: null }] };
  }
  const names = new Set(plan.slots.map((s) => s.scenario?.name.toLowerCase()));
  const lens = LENSES.find((l) => !names.has(l.name.toLowerCase())) ?? { name: `Variation ${n + 1}`, change: "Change the most important assumption and see whether the answer holds." };
  const order = ["rigorist", "skeptic", "pragmatist", "creative", "compliance", "cost"];
  return { ...plan, slots: [...plan.slots, { persona: order[n % order.length], tool, stance: null, scenario: { name: lens.name, change: lens.change } }] };
}

/** Pure. Where a schema problem is, in the words the editor uses. */
function where(kind: Plan["kind"], path: readonly PropertyKey[]): string {
  const noun = kind === "battle" ? "Team" : "Round";
  if (path[0] === "slots" && typeof path[1] === "number") {
    const field = path.slice(2).join(".");
    const name = field === "stance.label" ? "the prediction title" : field.startsWith("stance") ? "the prediction" : field === "scenario.name" ? "the scenario name" : field.startsWith("scenario") ? (kind === "loop" ? "what changes" : "the scenario angle") : field === "persona" ? "the approach" : field === "tool" ? "where it starts" : "this entry";
    return `${noun} ${path[1] + 1}: ${name}`;
  }
  return path[0] === "question" ? "The question" : path[0] === "success" ? "The success measure" : path[0] === "horizon" ? "The time frame" : "The plan";
}

/** Pure. Everything stopping a plan from running, in plain words (empty = ready). */
export function problemsOf(plan: Plan): string[] {
  const out: string[] = [];
  const r = Plan.safeParse(plan);
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 6)) {
      const w = where(plan.kind, i.path);
      out.push(i.code === "too_big" ? `${w} is too long` : i.code === "too_small" ? `${w} needs a little more text` : `${w} is not valid`);
    }
  }
  for (const p of planProblems(plan)) out.push(p.charAt(0).toUpperCase() + p.slice(1));
  return [...new Set(out)];
}
