"use client";
import { useAgent } from "@/components/agent/AgentProvider";
import { BattleStage } from "./BattleStage";
import { LoopStage } from "./LoopStage";

/**
 * The Battle or Loop screen. It covers the chat column (the sidebar stays), opens by itself when a contest starts, and closes back to the chat.
 * The thread keeps a short summary with a button to open it again.
 */
export function Stage() {
  const { stage, runs, closeStage } = useAgent();
  const run = runs.find((r) => r.id === stage.runId);
  const arena = run?.arena;
  if (!stage.open || !run || !arena) return null;
  return (
    <div data-testid="arena-stage" className="sheet-in absolute inset-0 z-[32] flex flex-col bg-canvas">
      {arena.mode === "battle" ? <BattleStage run={run} a={arena} onClose={closeStage} /> : <LoopStage run={run} a={arena} onClose={closeStage} />}
    </div>
  );
}
