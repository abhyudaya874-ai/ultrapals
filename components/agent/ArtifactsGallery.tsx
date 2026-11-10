"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconBoard, IconBolt, IconClock, IconFile, IconGlobe } from "@/components/ui/icons";
import { byMonth } from "./artifact-store";
import { useAgent } from "./AgentProvider";
import { APP_ARTIFACTS, displayName, type AppArtifactName } from "./panel-model";

const APP_ICON: Record<AppArtifactName, typeof IconFile> = { newsroom: IconGlobe, dashboard: IconBoard, timeline: IconClock, proctor: IconBolt };
type Filter = "all" | "chat" | "automation";
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "chat", label: "Created in chat" }, { id: "automation", label: "From automations" }];

/** Perplexity-style Artifacts page: the app's screens, and every file agents made that this browser remembers. */
export function ArtifactsGallery() {
  const { stored, openApp, openLocalFile } = useAgent();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => stored.filter((f) => filter === "all" || f.source === filter), [stored, filter]);
  const months = useMemo(() => byMonth(shown), [shown]);
  return (
    <main className="h-full overflow-y-auto" data-testid="artifacts-page">
      <div className="mx-auto w-full max-w-[1000px] px-6 py-8">
        <header>
          <h1 className="font-serif text-[30px] leading-tight text-fg">Artifacts</h1>
          <p className="mt-1 text-[14px] text-fg-muted">The app&apos;s own screens and the files your agents made. UltraPal can read both.</p>
        </header>

        <h2 className="mb-2 mt-7 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Apps</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(APP_ARTIFACTS) as AppArtifactName[]).map((n) => {
            const I = APP_ICON[n];
            return (
              <li key={n}>
                <button type="button" onClick={() => { openApp(n); router.push("/"); }} className="flex h-full w-full flex-col items-start gap-2 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-2">
                  <I className="size-5 text-fg-muted" />
                  <span className="text-[14.5px] font-medium text-fg">{APP_ARTIFACTS[n].title}</span>
                  <span className="text-[12.5px] leading-snug text-fg-dim">{APP_ARTIFACTS[n].blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mb-3 mt-9 flex items-center gap-2">
          <h2 className="mr-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Files</h2>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`h-7 rounded-full px-3 text-[12.5px] ${filter === f.id ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"}`}>{f.label}</button>
          ))}
        </div>
        {months.length === 0 && <p className="rounded-card border border-dashed border-line p-6 text-center text-[13.5px] text-fg-dim">No files yet. Ask UltraPal to research something and save it as a CSV, or run an automation.</p>}
        {months.map((m) => (
          <section key={m.month} className="mb-6">
            <h3 className="mb-2 text-[13px] text-fg-muted">{m.month}</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {m.files.map((f) => (
                <li key={`${f.source}|${f.from ?? ""}|${f.path}`}>
                  <button type="button" data-testid="stored-file" onClick={() => { openLocalFile(f.path, f.content); router.push("/"); }} className="flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-colors hover:bg-surface-2">
                    <pre className="h-28 overflow-hidden whitespace-pre-wrap break-words border-b border-line bg-canvas/50 p-3 font-mono text-[11px] leading-snug text-fg-dim">{f.content.split("\n").slice(0, 7).join("\n")}</pre>
                    <span className="flex items-center gap-2 p-3">
                      <IconFile className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0"><span className="block truncate text-[13px] text-fg">{displayName(f.path)}</span><span className="block truncate text-[11.5px] text-fg-dim">{f.source === "automation" ? `Automation: ${f.from ?? ""}` : "Chat"}</span></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
