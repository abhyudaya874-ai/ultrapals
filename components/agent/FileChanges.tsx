"use client";
import { useState } from "react";
import { IconChevronDown, IconFile } from "@/components/ui/icons";
import type { FileEdit } from "@/lib/computer/run";
import { useAgent } from "./AgentProvider";
import { DiffView } from "./DiffView";
import { displayName, fileTab, totals } from "./panel-model";

const INLINE_ROWS = 40;

function Row({ f, open: initial }: { f: FileEdit; open: boolean }) {
  const { openTab } = useAgent();
  const [open, setOpen] = useState(initial);
  const read = f.mode === "read";
  const word = read ? "Read" : f.created ? "Created" : "Edited";
  return (
    <li className="rounded-lg border border-line bg-surface" data-testid="file-row">
      <div className="flex items-center gap-1.5 pr-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 px-3 text-left">
          <IconFile className="size-4 shrink-0 text-fg-muted" />
          <span className="shrink-0 text-[13px] text-fg-muted">{word}</span>
          <span className="min-w-0 truncate font-mono text-[12.5px] text-fg">{displayName(f.path)}</span>
          {!read && <span className="shrink-0 text-[12px] tabular-nums"><span className="text-ok">+{f.adds}</span> <span className="text-bad">−{f.removes}</span></span>}
          {read && f.patch && <span className="shrink-0 text-[12px] text-fg-dim">{f.patch.length + (f.cut ?? 0)} lines</span>}
          <IconChevronDown className={`ml-auto size-4 shrink-0 text-fg-dim transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={() => openTab(fileTab(f.path))} className="h-7 shrink-0 rounded-md px-2 text-[12px] text-accent hover:bg-surface-2">Open</button>
      </div>
      {open && f.patch && <div className="px-2 pb-2"><DiffView lines={f.patch} cut={f.cut} max={INLINE_ROWS} tone={read ? "read" : "diff"} /></div>}
    </li>
  );
}

/** The files an agent wrote or read during a run, each with its green/red diff inline; "Open" puts the file in the artifact panel. */
export function FileChanges({ files }: { files: FileEdit[] }) {
  if (files.length === 0) return null;
  const t = totals(files);
  const wrote = files.filter((f) => f.mode !== "read").length;
  const read = files.length - wrote;
  const lastWrite = [...files].reverse().find((f) => f.mode !== "read");
  const label = [wrote ? `Edited ${wrote} file${wrote === 1 ? "" : "s"}` : "", read ? `read ${read}` : ""].filter(Boolean).join(", ");
  return (
    <section className="space-y-2" data-testid="files-card">
      <p className="text-[13.5px] text-fg-muted">
        <span className="font-medium text-fg">{label[0].toUpperCase() + label.slice(1)}</span>
        {wrote > 0 && <span className="ml-2 text-[12.5px] tabular-nums"><span className="text-ok">+{t.adds}</span> <span className="text-bad">−{t.removes}</span></span>}
      </p>
      <ul className="space-y-1.5">{files.map((f) => <Row key={f.id} f={f} open={f === lastWrite} />)}</ul>
    </section>
  );
}
