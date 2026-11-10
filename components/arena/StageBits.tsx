"use client";
import { IconX } from "@/components/ui/icons";

/** A tab in the stage's header: plain text with a line under the current one. */
export function StageTab({ on, disabled, title, onClick, children }: { on: boolean; disabled?: boolean; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} disabled={disabled} title={title} onClick={onClick}
      className={`press relative h-14 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-fg" : "text-fg-dim hover:text-fg-muted"}`}>
      {children}
    </button>
  );
}

export function StageClose({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Back to the chat" title="Back to the chat" data-testid="stage-close" className="press grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconX className="size-4" /></button>;
}
