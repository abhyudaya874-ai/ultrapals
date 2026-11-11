"use client";
import { useId, useState } from "react";
import { IconChevronDown } from "@/components/ui/icons";

export function Disclosure({ label, meta, defaultOpen = false, testId, children }: {
  label: React.ReactNode; meta?: React.ReactNode; defaultOpen?: boolean; testId?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section data-testid={testId}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-1.5 text-left text-[14px] text-fg-muted hover:text-fg">
        <span className="truncate">{label}</span>
        {meta && <span className="truncate text-fg-dim">{meta}</span>}
        <IconChevronDown className={`ml-auto size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={id} inert={!open} className="snap-grow" data-open={open}>
        <div>{children}</div>
      </div>
    </section>
  );
}
