"use client";
import { useMemo, useState } from "react";
import { IconCheck, IconCopy, IconDownload } from "@/components/ui/icons";
import { PREVIEW_CHARS, parseCsv } from "@/lib/computer/artifacts";
import type { FileEdit } from "@/lib/computer/run";
import { useAgent } from "./AgentProvider";
import { DiffView } from "./DiffView";
import { Markdown } from "./Markdown";
import { baseName, displayName, fileKind } from "./panel-model";

type View = "preview" | "changes" | "read";

/** Pure. JSON that parses is shown indented; anything else is shown as written. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text, 300), [text]);
  if (rows.length === 0) return <p className="p-4 text-[13px] text-fg-dim">The file is empty.</p>;
  return (
    <div className="overflow-auto" data-testid="csv-preview">
      <table className="w-max min-w-full border-collapse text-[12.5px]">
        <thead>
          <tr>{rows[0].map((c, j) => <th key={j} className="sticky top-0 border border-line bg-surface-2 px-2.5 py-1.5 text-left font-medium text-fg">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, i) => (
            <tr key={i} className="odd:bg-surface/40">
              {r.map((c, j) => <td key={j} className="max-w-[22rem] border border-line px-2.5 py-1.5 align-top text-fg-muted" title={c}><span className="line-clamp-3 whitespace-pre-wrap break-words">{c}</span></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One file as a tab: its content (table, markdown, JSON or text), the green/red diff of its last write, and the lines of its last read. */
export function FileArtifact({ path, content, write, read }: { path: string; content: string; write?: FileEdit; read?: FileEdit }) {
  const { send, busy } = useAgent();
  const kind = fileKind(path);
  const hasChanges = !!write?.patch && (write.adds > 0 || write.removes > 0);
  const hasRead = !!read?.patch;
  const [picked, setPicked] = useState<View | null>(null);
  // an edited file opens on its diff; a new or only-read file opens on its content
  const view: View = picked ?? (write && !write.created && hasChanges ? "changes" : "preview");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: kind === "csv" ? "text/csv" : "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName(path);
    a.click();
    URL.revokeObjectURL(url);
  };
  const tabs: { id: View; label: string }[] = [{ id: "preview", label: kind === "csv" ? "Table" : "Preview" }, ...(hasChanges ? [{ id: "changes" as const, label: "Changes" }] : []), ...(hasRead ? [{ id: "read" as const, label: "Read" }] : [])];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="file-artifact">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-fg" title={path}>{displayName(path)}</span>
        {write && <span className="text-[12px] text-fg-dim">{write.created ? "created" : "edited"}</span>}
        {write && <span className="text-[12px] tabular-nums"><span className="text-ok">+{write.adds}</span> <span className="text-bad">−{write.removes}</span></span>}
        {!write && read && <span className="text-[12px] text-fg-dim">read</span>}
        <span className="ml-auto flex items-center gap-1">
          {tabs.length > 1 && (
            <span className="mr-1 flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="View">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={view === t.id} onClick={() => setPicked(t.id)} className={`h-7 rounded-md px-2.5 text-[12.5px] ${view === t.id ? "bg-line text-fg" : "text-fg-muted hover:text-fg"}`}>{t.label}</button>
              ))}
            </span>
          )}
          {kind === "csv" && <button type="button" disabled={busy} onClick={() => void send(`Chart ${displayName(path)} with the best-fitting chart type and tell me what it shows.`)} className="mr-1 h-7 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" title="UltraPal picks the chart type that fits this table">Chart it</button>}
          <button type="button" onClick={() => void copy()} aria-label="Copy file text" title="Copy" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">{copied ? <IconCheck className="size-4 text-ok" /> : <IconCopy className="size-4" />}</button>
          <button type="button" onClick={download} aria-label="Download file" title="Download" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconDownload className="size-4" /></button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {view === "changes" && write?.patch && <DiffView lines={write.patch} cut={write.cut} />}
        {view === "read" && read?.patch && <DiffView lines={read.patch} cut={read.cut} tone="read" />}
        {view === "preview" && (kind === "csv" ? <CsvTable text={content} /> : kind === "md" ? <Markdown text={content} /> : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-fg-muted">{kind === "json" ? prettyJson(content) : content}</pre>
        ))}
        {view === "preview" && content.length >= PREVIEW_CHARS && <p className="mt-3 text-[12px] text-fg-dim">Showing the first {PREVIEW_CHARS.toLocaleString("en-US")} characters.</p>}
      </div>
    </div>
  );
}
