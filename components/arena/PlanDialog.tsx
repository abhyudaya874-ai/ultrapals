"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useAgent, type PendingPlan } from "@/components/agent/AgentProvider";
import { PERSONAS } from "@/lib/arena/personas";
import { MAX_SLOTS, type Plan, type Slot } from "@/lib/arena/plan";
import { addSlot, canAdd, canRemove, problemsOf, removeSlot, updateSlot } from "@/lib/arena/plan-edit";
import type { Tool } from "@/lib/arena/types";

const INPUT = "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-dock-line";
const TOOLS: { value: Tool; label: string }[] = [{ value: "research", label: "Web research" }, { value: "browser", label: "The browser" }, { value: "terminal", label: "The terminal" }];

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12px] text-fg-dim">{label}</label>
      {children(id)}
      {hint && <p className="text-[12px] text-fg-dim">{hint}</p>}
    </div>
  );
}

function SlotEditor({ plan, i, onChange, onRemove }: { plan: Plan; i: number; onChange: (patch: Partial<Slot>) => void; onRemove: (() => void) | null }) {
  const s = plan.slots[i];
  const battle = plan.kind === "battle";
  const [angle, setAngle] = useState(!!s.scenario);
  const taken = new Set(plan.slots.filter((_, k) => k !== i).map((x) => x.persona));
  const sc = s.scenario ?? { name: "", change: "" };
  return (
    <li className="space-y-3 border-t border-line py-4" data-testid="plan-slot">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.14em] text-fg-muted">{battle ? "Team" : "Round"} {i + 1}</h3>
        {onRemove && <button type="button" onClick={onRemove} className="press rounded px-1.5 py-0.5 text-[12px] text-fg-dim hover:text-bad">Remove</button>}
      </div>
      {battle ? (
        <>
          <Field label="Prediction in a few words">{(id) => <input id={id} className={INPUT} maxLength={80} value={s.stance?.label ?? ""} onChange={(e) => onChange({ stance: { label: e.target.value, text: s.stance?.text ?? "" } })} />}</Field>
          <Field label="What this team will try to show" hint="A hypothesis to test with real evidence. If the evidence disagrees, the team says so.">
            {(id) => <textarea id={id} rows={2} className={`${INPUT} resize-none`} maxLength={300} value={s.stance?.text ?? ""} onChange={(e) => onChange({ stance: { label: s.stance?.label ?? "", text: e.target.value } })} />}
          </Field>
          {angle ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Scenario angle">{(id) => <input id={id} className={INPUT} maxLength={40} placeholder="Name" value={sc.name} onChange={(e) => onChange({ scenario: { ...sc, name: e.target.value } })} />}</Field>
              <Field label="What is different">{(id) => <input id={id} className={INPUT} maxLength={300} placeholder="Assume…" value={sc.change} onChange={(e) => onChange({ scenario: { ...sc, change: e.target.value } })} />}</Field>
            </div>
          ) : (
            <button type="button" onClick={() => setAngle(true)} className="press text-[12.5px] text-accent hover:underline">Give this team a different version of the scenario</button>
          )}
          {angle && <button type="button" onClick={() => { setAngle(false); onChange({ scenario: null }); }} className="press text-[12px] text-fg-dim hover:text-fg">Use the scenario as written</button>}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Field label="Scenario name">{(id) => <input id={id} className={INPUT} maxLength={40} value={sc.name} onChange={(e) => onChange({ scenario: { ...sc, name: e.target.value } })} />}</Field>
            <Field label="What is different in this round">{(id) => <input id={id} className={INPUT} maxLength={300} value={sc.change} onChange={(e) => onChange({ scenario: { ...sc, change: e.target.value } })} />}</Field>
          </div>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Approach">
          {(id) => (
            <select id={id} className={INPUT} value={s.persona} onChange={(e) => onChange({ persona: e.target.value })}>
              {PERSONAS.map((p) => <option key={p.id} value={p.id} disabled={battle && taken.has(p.id)}>{p.name}: {p.blurb}</option>)}
            </select>
          )}
        </Field>
        <Field label="Starts with">
          {(id) => (
            <select id={id} className={INPUT} value={s.tool} onChange={(e) => onChange({ tool: e.target.value as Tool })}>
              {TOOLS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
        </Field>
      </div>
    </li>
  );
}

function Editor({ pending, onApprove, onCancel }: { pending: PendingPlan & { plan: Plan }; onApprove: (p: Plan) => void; onCancel: () => void }) {
  const [plan, setPlan] = useState<Plan>(pending.plan);
  const battle = plan.kind === "battle";
  const problems = problemsOf(plan);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
      <div className="space-y-4 pb-5">
        <Field label="The question every team answers">
          {(id) => <textarea id={id} rows={2} autoFocus className={`${INPUT} resize-none`} maxLength={300} value={plan.question} onChange={(e) => setPlan({ ...plan, question: e.target.value })} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What a good outcome looks like">{(id) => <input id={id} className={INPUT} maxLength={300} value={plan.success} onChange={(e) => setPlan({ ...plan, success: e.target.value })} />}</Field>
          <Field label="Time frame">{(id) => <input id={id} className={INPUT} maxLength={80} value={plan.horizon} onChange={(e) => setPlan({ ...plan, horizon: e.target.value })} />}</Field>
        </div>
      </div>
      <ol>
        {plan.slots.map((_, i) => <SlotEditor key={i} plan={plan} i={i} onChange={(patch) => setPlan(updateSlot(plan, i, patch))} onRemove={canRemove(plan) ? () => setPlan(removeSlot(plan, i)) : null} />)}
      </ol>
      </div>
      <div className="shrink-0 border-t border-line px-6 pb-5 pt-4">
        {problems.length > 0 && (
          <ul className="mb-3 space-y-0.5 text-[12.5px] text-bad" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <div className="flex items-center gap-3">
          {canAdd(plan) ? <button type="button" onClick={() => setPlan(addSlot(plan))} className="press rounded-full px-2 py-1 text-[13px] text-fg-muted hover:text-fg">Add {battle ? "a team" : "a round"}</button> : <span className="text-[12px] text-fg-dim">The most is {MAX_SLOTS}.</span>}
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className="press h-9 rounded-full px-4 text-[13.5px] text-fg-muted hover:text-fg">Cancel</button>
          <button type="button" disabled={problems.length > 0} onClick={() => onApprove(plan)} data-testid="plan-approve" className="press h-9 rounded-full bg-fg px-5 text-[13.5px] font-medium text-canvas hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">
            Start the {battle ? "battle" : "loop"}
          </button>
        </div>
      </div>
    </>
  );
}

function Drafting() {
  return (
    <div className="space-y-3 py-6" aria-busy="true" aria-live="polite">
      <p className="text-[13.5px] text-fg-muted">Drafting the scenarios…</p>
      {[70, 90, 55].map((w) => <div key={w} className="shimmer h-9 rounded-lg bg-surface-2" style={{ width: `${w}%` }} />)}
    </div>
  );
}

/** The review step for a Battle or Loop whose scenarios a person approves (after a model drafts them) or writes. Nothing runs until Start. */
export function PlanDialog() {
  const { pendingPlan, approvePlan, cancelPlan } = useAgent();
  useEffect(() => {
    if (!pendingPlan) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") cancelPlan(); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [pendingPlan, cancelPlan]);
  if (!pendingPlan) return null;
  const battle = pendingPlan.kind === "battle";
  return (
    <div className="fade-in fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelPlan(); }}>
      <div role="dialog" aria-modal="true" aria-label={battle ? "Review the battle" : "Review the loop"} data-testid="plan-dialog" className="sheet-in flex max-h-[88dvh] w-[min(680px,100%)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="shrink-0 px-6 pb-4 pt-6">
          <h2 className="font-serif text-[24px] leading-tight text-fg">{pendingPlan.planMode === "manual" ? "Write the scenarios" : "Review the scenarios"}</h2>
          {pendingPlan.note && <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{pendingPlan.note}</p>}
        </header>
        {pendingPlan.plan ? <Editor key={pendingPlan.plan.question + pendingPlan.plan.slots.length} pending={{ ...pendingPlan, plan: pendingPlan.plan }} onApprove={approvePlan} onCancel={cancelPlan} /> : <div className="px-6 pb-6"><Drafting /></div>}
      </div>
    </div>
  );
}
