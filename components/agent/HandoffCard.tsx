"use client";
import { IconGlobe } from "@/components/ui/icons";
import type { Run } from "@/lib/computer/run";
import { useAgent } from "./AgentProvider";

/** In the thread: the agent stopped for the person. Says what to do, brings the browser up, and continues when asked. Only the latest request can be answered. */
export function HandoffCard({ h, latest }: { h: NonNullable<Run["handoff"]>; latest: boolean }) {
  const { setPip, send, busy } = useAgent();
  return (
    <div className="flex items-start gap-3 rounded-card border border-line border-l-2 border-l-warn bg-surface px-4 py-3" data-testid="handoff-card">
      <IconGlobe className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-fg">{latest ? "Waiting for you" : "You were asked for help"}</p>
        <p className="text-[13px] leading-snug text-fg-muted">{h.reason}</p>
      </div>
      {latest && (
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => setPip({ open: true, expanded: true })} className="press h-8 rounded-full border border-line px-3 text-[12.5px] text-fg-muted hover:border-dock-line hover:text-fg">Open the browser</button>
          <button type="button" disabled={busy} onClick={() => void send("continue")} className="press h-8 rounded-full bg-fg px-3.5 text-[12.5px] font-medium text-canvas hover:bg-white disabled:opacity-50">Continue</button>
        </div>
      )}
    </div>
  );
}
