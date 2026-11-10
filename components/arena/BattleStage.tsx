"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArenaState, Run } from "@/lib/computer/run";
import { progressOf } from "@/lib/arena/view";
import { Bracket } from "./Bracket";
import { ContenderPanel } from "./ContenderPanel";
import { Duel } from "./Duel";
import { PanelBoard } from "./PanelBoard";
import { BattleResults } from "./Results";
import { StageClose, StageTab } from "./StageBits";

type View = "panels" | "bracket" | "results";

/**
 * Battle: the teams side by side while they work, then the knockout (the latest match played back, the bracket under it), then the results.
 * It moves to the bracket when the first match is decided and to the results when the battle ends; the tabs always work.
 */
export function BattleStage({ run, a, onClose }: { run: Run; a: ArenaState; onClose: () => void }) {
  const [view, setView] = useState<View>(a.final ? "results" : a.matches.length > 0 ? "bracket" : "panels");
  const auto = useRef({ bracket: a.matches.length > 0, results: !!a.final });
  useEffect(() => {
    if (a.matches.length > 0 && !auto.current.bracket) { auto.current.bracket = true; setView("bracket"); }
    if (a.final && !auto.current.results) { auto.current.results = true; setView("results"); }
  }, [a.matches.length, a.final]);

  const names = useMemo(() => Object.fromEntries(a.contenders.map((c) => [c.info.id, c.info.name])), [a.contenders]);
  const ids = useMemo(() => a.contenders.map((c) => c.info.id), [a.contenders]);
  const byId = useMemo(() => new Map(a.contenders.map((c) => [c.info.id, c])), [a.contenders]);
  const latest = [...a.matches].reverse().find((m) => m.duel);
  const p = progressOf(a);
  const fighter = (id: string | null) => { const c = id ? byId.get(id) : undefined; return c ? { id: c.info.id, name: c.info.name, tool: c.info.tool } : null; };
  const [fa, fb] = latest ? [fighter(latest.a), fighter(latest.b)] : [null, null];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line px-5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium text-fg">Battle</h2>
          <p className="truncate text-[12px] text-fg-dim" aria-live="polite">{p.text}</p>
        </div>
        <nav className="flex gap-6" role="tablist" aria-label="Battle views">
          <StageTab on={view === "panels"} onClick={() => setView("panels")}>Panels</StageTab>
          <StageTab on={view === "bracket"} onClick={() => setView("bracket")}>Bracket</StageTab>
          <StageTab on={view === "results"} disabled={!a.final} title={a.final ? undefined : "Available when the battle ends"} onClick={() => setView("results")}>Results</StageTab>
        </nav>
        <span className="flex-1" />
        <StageClose onClick={onClose} />
      </header>
      <p className="shrink-0 px-5 pt-4 font-serif text-[19px] leading-snug text-fg" data-testid="stage-question">{a.question}</p>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`stage-${view}`}>
        {view === "panels" && (
          <div className="h-full p-3.5">
            <PanelBoard ids={ids} render={(id, hooks) => { const c = byId.get(id); return c ? <ContenderPanel c={c} hooks={hooks} winner={a.final?.winner === id} /> : null; }} />
          </div>
        )}
        {view === "bracket" && (
          <div className="space-y-10 px-5 py-8">
            {latest && fa && fb ? <Duel key={latest.id} match={latest} a={fa} b={fb} /> : <p className="py-10 text-center text-[13px] text-fg-dim">{a.phase === "running" ? "The knockout starts when every team has reported." : a.phaseNote ?? "The knockout is about to start."}</p>}
            {!a.final && a.phase === "judging" && latest && <p className="text-center text-[12.5px] text-fg-dim" aria-live="polite">The blind judge is scoring the next match…</p>}
            <Bracket arena={a} names={names} />
          </div>
        )}
        {view === "results" && a.final && <BattleResults run={run} a={a} />}
      </div>
    </>
  );
}
