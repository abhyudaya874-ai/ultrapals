"use client";
import { useState } from "react";
import { IconCheck, IconCopy, IconList, IconPanelLeft } from "@/components/ui/icons";
import { useShell } from "./AppShell";

export function TopBar({ title, onOutline, outlineOpen }: { title: string; onOutline: () => void; outlineOpen: boolean }) {
  const { openSidebar } = useShell();
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the link is still in the address bar */ }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4" data-testid="topbar">
      <button type="button" aria-label="Open sidebar" onClick={openSidebar} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden">
        <IconPanelLeft className="size-[18px]" />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{title}</h1>
      <button type="button" onClick={onOutline} aria-label="Outline" aria-pressed={outlineOpen}
        className={`rounded-lg p-2 transition-colors ${outlineOpen ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
        <IconList className="size-[18px]" />
      </button>
      <button type="button" onClick={copyLink}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
        {copied ? <IconCheck className="size-4 text-ok" /> : <IconCopy className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </header>
  );
}
