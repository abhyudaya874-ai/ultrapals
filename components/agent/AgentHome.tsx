"use client";
import { useMemo, useRef } from "react";
import { useStickToBottom } from "@/components/thread/Dock";
import { IconArrowDown, IconBoard, IconBolt, IconClock, IconGlobe, IconLayers, IconPlus } from "@/components/ui/icons";
import { UltraOrb } from "@/components/orbs/Orbs";
import { ultraState } from "@/components/orbs/mood";
import { heroLine, heroTitle } from "@/components/arena/cast";
import { ModeCast } from "@/components/arena/ModeCast";
import { PAL_NAMES } from "@/lib/computer/pals";
import { useAgent } from "./AgentProvider";
import { PromptBox } from "./PromptBox";
import { fillPrompt } from "./prompt-model";
import { APP_ARTIFACTS } from "./panel-model";
import { RunView } from "./RunView";
import { SUGGESTION_CAPTION, startsAtOnce, suggestionsFor } from "./suggestions";

const HERO_LINE = "Research the web, drive a live browser, run commands, and move sandbox money only when a verdict computed in code says so.";

/** The main screen: UltraPal as a full-width chat. Artifacts open in the panel on the right (see ArtifactPanel). */
export function AgentHome() {
  const { runs, busy, newChat, panel, openTab, openApp, send, mode } = useAgent();
  const scroller = useRef<HTMLDivElement>(null);
  const size = runs.reduce((n, r) => n + r.answer.length + r.timeline.length + r.agents.reduce((m, a) => m + a.steps.length + a.terms.length + a.files.length, 0), 0);
  const stick = useStickToBottom(scroller, size);
  const hasTabs = panel.tabs.length > 0;
  const ultra = useMemo(() => ultraState(runs.at(-1), busy), [runs, busy]);

  if (runs.length === 0) {
    return (
      <main className="h-full overflow-y-auto" data-testid="agent-home">
        <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center gap-6 px-6 py-10">
          <header>
            <ModeCast mode={mode} state={ultra} />
            <h1 className="font-serif text-[40px] leading-tight text-fg" data-testid="hero-title">{heroTitle(mode, PAL_NAMES.main)}</h1>
            <p className="mt-1 text-[15px] text-fg-muted" data-testid="hero-line">{heroLine(mode, HERO_LINE)}</p>
          </header>
          <PromptBox variant="hero" placeholder="Ask, build, research, or paste a screenshot…" />
          <div>
            {SUGGESTION_CAPTION[mode.kind] && <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim" data-testid="suggestion-caption">{SUGGESTION_CAPTION[mode.kind]}</p>}
            <ul key={mode.kind} className="grid gap-2 sm:grid-cols-2" aria-label="Suggestions" data-testid="suggestions" data-mode={mode.kind}>
              {suggestionsFor(mode.kind).map((s) => (
                <li key={s.text} className="fade-in">
                  <button type="button" onClick={() => (startsAtOnce(mode.kind) ? void send(s.text) : fillPrompt(s.text))} disabled={busy} className="press h-full w-full rounded-card border border-dashed border-line px-3.5 py-3 text-left text-[13.5px] leading-snug text-fg-muted transition-colors hover:border-dock-line hover:bg-surface hover:text-fg disabled:opacity-50">
                    {s.text}
                    {s.automation && <span className="mt-1.5 flex items-center gap-1 text-[11.5px] text-fg-dim"><IconBolt className="size-3" />Creates an automation</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <section aria-label="Open an artifact">
            <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-dim">Open as an artifact</h2>
            <div className="flex flex-wrap gap-2">
              {(["newsroom", "dashboard", "timeline", "proctor"] as const).map((n) => (
                <button key={n} type="button" onClick={() => openApp(n)} title={APP_ARTIFACTS[n].blurb} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
                  {n === "newsroom" ? <IconGlobe className="size-4" /> : n === "timeline" ? <IconClock className="size-4" /> : n === "dashboard" ? <IconBoard className="size-4" /> : <IconLayers className="size-4" />}
                  {APP_ARTIFACTS[n].title}
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }
  return (
    <main className="flex h-full min-h-0 flex-col" data-testid="agent-home">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <UltraOrb size={36} state={ultra} />
        <h1 className="text-[15px] font-medium text-fg">{PAL_NAMES.main}</h1>
        <span className="text-[12px] text-fg-dim">{busy ? "working…" : "ready"}</span>
        <span className="ml-auto flex items-center gap-1">
          {hasTabs && !panel.open && (
            <button type="button" onClick={() => openTab(panel.active ?? panel.tabs[0])} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"><IconLayers className="size-4" />Artifacts {panel.tabs.length}</button>
          )}
          <button type="button" onClick={newChat} aria-label="New chat" title="New chat" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><IconPlus className="size-4" /></button>
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={stick.onScroll} className="h-full overflow-y-auto" data-testid="agent-thread">
          <div className="mx-auto w-full max-w-[760px] space-y-8 px-5 pb-8 pt-2">
            {runs.map((r, i) => <RunView key={r.id} run={r} latest={i === runs.length - 1} />)}
          </div>
        </div>
        {stick.away && (
          <button type="button" onClick={stick.jump} aria-label="Scroll to latest" className="absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-fg-muted shadow-lg hover:text-fg"><IconArrowDown className="size-4" /></button>
        )}
      </div>
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4"><PromptBox variant="dock" /></div>
    </main>
  );
}
