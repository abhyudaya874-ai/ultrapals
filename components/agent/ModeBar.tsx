"use client";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { IconBattle, IconBolt, IconChat, IconChevronDown, IconLoop, IconPencil, IconSparkles } from "@/components/ui/icons";
import { COUNTS, MODE_INFO, countHint, defaultCount, type ModeKind } from "@/lib/arena/mode";
import { PLAN_LABEL, PLAN_MODES, type PlanMode } from "@/lib/arena/plan";
import { useAgent } from "./AgentProvider";

const ICON: Record<ModeKind, React.ReactNode> = { chat: <IconChat className="size-4" />, battle: <IconBattle className="size-4" />, loop: <IconLoop className="size-4" /> };
const PLAN_ICON: Record<PlanMode, React.ReactNode> = { auto: <IconBolt className="size-4" />, ai: <IconSparkles className="size-4" />, manual: <IconPencil className="size-4" /> };
/** Short names for the chip; the menu shows the full ones. */
const PLAN_SHORT: Record<PlanMode, string> = { auto: "Autopilot", ai: "AI draft", manual: "I set it" };
const caret = <IconChevronDown className="size-3.5 opacity-70" />;

/**
 * Chat, Battle or Loop, like the model picker in Arena: pick the mode, then (for Battle and Loop) how many, and who sets the scenarios.
 * The count and the plan chips only exist while a Battle or Loop is selected.
 */
export function ModeBar({ disabled }: { disabled?: boolean }) {
  const { mode, setMode } = useAgent();
  const kinds: MenuItem<ModeKind>[] = (["chat", "battle", "loop"] as const).map((k) => ({ value: k, label: MODE_INFO[k].title, hint: MODE_INFO[k].blurb, icon: ICON[k] }));
  const arena = mode.kind !== "chat";
  const unit = MODE_INFO[mode.kind].unit;
  return (
    <>
      <Menu label="Mode" value={mode.kind} items={kinds} disabled={disabled} testId="mode-menu" width="w-80"
        onChange={(kind) => setMode({ ...mode, kind, n: kind === mode.kind ? mode.n : defaultCount(kind) })}>
        <span className={arena ? "text-accent" : ""}>{ICON[mode.kind]}</span>
        <span>{MODE_INFO[mode.kind].title}</span>{caret}
      </Menu>
      {arena && (
        <>
          <Menu label={mode.kind === "battle" ? "Number of teams" : "Number of rounds"} value={mode.n} disabled={disabled} testId="count-menu" width="w-72"
            items={COUNTS.map((n) => ({ value: n, label: `${n} ${unit}`, hint: countHint(mode.kind, n) }))} onChange={(n) => setMode({ ...mode, n })}>
            <span className="tabular-nums">{mode.n}</span><span className="hidden sm:inline">{unit}</span>{caret}
          </Menu>
          <Menu label="Who sets the scenarios" value={mode.plan} disabled={disabled} testId="plan-menu" width="w-80"
            items={PLAN_MODES.map((p) => ({ value: p, label: PLAN_LABEL[p].title, hint: PLAN_LABEL[p].blurb, icon: PLAN_ICON[p] }))} onChange={(plan) => setMode({ ...mode, plan })}>
            {PLAN_ICON[mode.plan]}<span>{PLAN_SHORT[mode.plan]}</span>{caret}
          </Menu>
        </>
      )}
    </>
  );
}
