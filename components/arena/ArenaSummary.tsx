"use client";
import { useAgent } from "@/components/agent/AgentProvider";
import { FlatOrb } from "@/components/orbs/Orbs";
import { lookFor } from "@/components/orbs/palette";
import { progressOf } from "@/lib/arena/view";
import type { Run } from "@/lib/computer/run";

/** In the thread, a contest is one quiet line: what it is, how far along, and who won. Press it to open the screen. */
export function ArenaSummary({ run }: { run: Run }) {
  const { openStage, stage } = useAgent();
  const a = run.arena;
  if (!a) return null;
  const p = progressOf(a);
  const winner = a.final ? a.contenders.find((c) => c.info.id === a.final!.winner) : null;
  const open = stage.open && stage.runId === run.id;
  return (
    <button type="button" onClick={() => openStage(run.id)} aria-pressed={open} data-testid="arena-summary"
      className="press flex w-full items-center gap-4 rounded-card border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-dock-line">
      <span className="flex -space-x-2" aria-hidden>
        {a.contenders.slice(0, 6).map((c) => <span key={c.info.id} className="rounded-full ring-2 ring-surface"><FlatOrb size={26} look={lookFor(c.info.id, "battle")} interactive={false} mood={c.state === "error" ? "error" : "idle"} /></span>)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg">{a.mode === "battle" ? "Battle" : "Loop"} · {a.contenders.length}{a.adaptive && a.phase !== "done" ? ` of up to ${a.max}` : ""} {a.mode === "battle" ? "teams" : "rounds"}</span>
        <span className="block truncate text-[12.5px] text-fg-dim">{winner ? `${a.mode === "battle" ? "Champion" : "Best round"}: ${winner.info.name}${winner.score ? ` · ${winner.score.total} out of 10` : ""}` : p.text}</span>
      </span>
      <span className="shrink-0 text-[13px] text-fg-muted">{open ? "Open" : "Open the screen"}</span>
    </button>
  );
}
