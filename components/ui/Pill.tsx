"use client";
import { useState } from "react";
import { Collapse } from "@/components/ui/Collapse";
import { IconChevronDown } from "@/components/ui/icons";

/** Dark rounded chip with an icon and a name, like the agent chips in Perplexity Computer. Optionally collapses a body underneath. */
export function Pill({ icon, name, children, testId }: { icon?: React.ReactNode; name: string; children?: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const chip = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line bg-black/35 px-2.5 text-[13px] text-fg";
  if (!children) return <span className={chip} data-testid={testId}>{icon}<span className="truncate">{name}</span></span>;
  return (
    <span className="block" data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${chip} transition-colors hover:bg-black/55`}>
        {icon}
        <span className="truncate">{name}</span>
        <IconChevronDown className={`size-3.5 shrink-0 text-fg-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <Collapse open={open}><p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-black/25 px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">{children}</p></Collapse>
    </span>
  );
}
