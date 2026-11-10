"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BattleOrb, UltraOrb } from "@/components/orbs/Orbs";
import { roundViews, statusText, type RoundView } from "@/lib/arena/view";
import type { ArenaState, Run } from "@/lib/computer/run";
import { ContenderPanel } from "./ContenderPanel";
import { Chip, DiffView, RoundBrief } from "./Diff";
import { LoopResults } from "./LoopResults";
import { LABEL } from "./ResultsParts";
import { StageClose, StageTab } from "./StageBits";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The score as a ring around the orb: it draws itself once, when the orb arrives in the rail. */
function Ring({ score, best }: { score: number; best: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const f = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(f); }, []);
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="2" className="stroke-line" />
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={on ? c * (1 - Math.min(10, Math.max(0, score)) / 10) : c} className={best ? "stroke-fg" : "stroke-fg-dim"} style={{ transition: `stroke-dashoffset 700ms ${EASE} 200ms, stroke 200ms` }} />
    </svg>
  );
}

const deltaText = (d: number | null): { text: string; cls: string } => (d === null ? { text: "", cls: "" } : d > 0 ? { text: `▲ ${d}`, cls: "text-ok" } : d < 0 ? { text: `▼ ${Math.abs(d)}`, cls: "text-bad" } : { text: "•", cls: "text-fg-dim" });

/** A finished round in the rail: its orb, the score as a ring, and how it did against the round before. Press it to open the whole run. */
function Story({ r, open, reg, onOpen }: { r: RoundView; open: boolean; reg: (id: string, el: HTMLElement | null) => void; onOpen: () => void }) {
  const c = r.c;
  const d = deltaText(r.diff?.score.delta ?? null);
  return (
    <li className="flex w-12 flex-col items-center gap-1" data-testid="story" data-round={r.round}>
      <button ref={(el) => reg(c.info.id, el)} type="button" onClick={onOpen} aria-expanded={open} aria-label={`Round ${r.round}, ${c.info.scenarioName ?? c.info.name}, scored ${r.entry!.score.total}${r.best ? ", the best so far" : ""}. Open its run.`}
        className="press relative size-12 rounded-full">
        <Ring score={r.entry!.score.total} best={r.best} />
        <span className="absolute inset-[9px]"><BattleOrb id={c.info.id} size={30} state="ok" tool={c.info.tool} winner={r.best} /></span>
      </button>
      <span className="flex h-3 items-center gap-1 text-[10.5px] leading-none tabular-nums"><span className="text-fg-dim">{r.best ? "best" : `R${r.round}`}</span><span className={d.cls}>{d.text}</span></span>
    </li>
  );
}

/** A round that exists but has not finished: an empty ring with its number. The one running now is a little brighter. */
function Waiting({ r, live }: { r: RoundView; live: boolean }) {
  return (
    <li className="flex w-12 flex-col items-center gap-1" data-testid="story-waiting">
      <span className={`grid size-12 place-items-center rounded-full border border-dashed text-[12px] tabular-nums ${live ? "border-fg-dim text-fg-muted" : "border-line text-fg-dim"}`}>{r.round}</span>
      <span className="h-3 text-[10.5px] leading-none text-fg-dim">{live ? "now" : ""}</span>
    </li>
  );
}

/** The whole run of one round, opened from the rail: what changed from the round before, then its panel with every tab. */
function Sheet({ r, onClose }: { r: RoundView; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [onClose]);
  const c = r.c;
  const score = r.entry?.score.total;
  return (
    <div role="dialog" aria-label={`Round ${r.round}`} data-testid="round-sheet" className="pop-in-down absolute left-3 top-[72px] z-40 flex max-h-[calc(100%-88px)] w-[min(780px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-dock-line bg-surface shadow-2xl">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <BattleOrb id={c.info.id} size={36} state={c.state} tool={c.info.tool} winner={r.best} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-medium text-fg">Round {r.round} · {c.info.scenarioName ?? c.info.name}</h3>
          <p className="truncate text-[12px] text-fg-dim">{statusText(c)}</p>
        </div>
        {score !== undefined && <Chip className="border-dock-line text-fg">{score} out of 10</Chip>}
        {r.best && <Chip className="text-fg-muted">best</Chip>}
        <StageClose onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {r.diff ? <DiffView d={r.diff} /> : <RoundBrief info={c.info} />}
        <div className="h-[420px]"><ContenderPanel c={c} bare /></div>
      </div>
    </div>
  );
}

/** The middle of the screen while a round runs: its orb large, what is different about it, and its live panel. */
function Live({ r, a, orbRef }: { r: RoundView; a: ArenaState; orbRef: React.RefObject<HTMLSpanElement | null> }) {
  const c = r.c;
  return (
    <div className="mx-auto max-w-[820px] space-y-6 px-6 py-8" data-testid="live-round">
      <div className="flex items-center gap-5">
        <span ref={orbRef} className="relative inline-block size-24 shrink-0"><BattleOrb id={c.info.id} size={96} state={c.state} tool={c.info.tool} /></span>
        <div className="min-w-0">
          <p className={LABEL}>Round {r.round} of {a.adaptive ? `up to ${a.max}` : a.max}</p>
          <h2 className="truncate font-serif text-[28px] leading-tight text-fg">{c.info.scenarioName ?? c.info.name}</h2>
          <p className="text-[13px] text-fg-dim" aria-live="polite">{statusText(c)}</p>
        </div>
      </div>
      <RoundBrief info={c.info} />
      <div className="h-[min(520px,56dvh)]"><ContenderPanel c={c} bare /></div>
    </div>
  );
}

type View = "live" | "results";

/**
 * Loop: one round at a time in the middle. When a round has been scored, its orb flies into the row at the top left, beside the sidebar, and
 * keeps a ring with its score and its change from the round before; then the next round starts. Press any orb in the row to open that round's
 * whole run. The results open when the loop ends.
 */
export function LoopStage({ run, a, onClose }: { run: Run; a: ArenaState; onClose: () => void }) {
  const rounds = useMemo(() => roundViews(a), [a]);
  const [view, setView] = useState<View>(a.final ? "results" : "live");
  const [open, setOpen] = useState<string | null>(null);
  const [flown, setFlown] = useState<Set<string>>(() => new Set(rounds.filter((r) => r.entry).map((r) => r.c.info.id)));
  const slots = useRef(new Map<string, HTMLElement>());
  const big = useRef<HTMLSpanElement>(null);
  const pending = useRef(new Map<string, DOMRect | null>());
  const auto = useRef(!!a.final);

  useEffect(() => {
    if (a.final && !auto.current) { auto.current = true; setView("results"); }
  }, [a.final]);

  // a round that has just been scored leaves the middle: note where its orb is now, then let the rail take it
  useLayoutEffect(() => {
    const fresh = rounds.filter((r) => r.entry && !flown.has(r.c.info.id));
    if (fresh.length === 0) return;
    const from = big.current?.getBoundingClientRect() ?? null;
    for (const r of fresh) pending.current.set(r.c.info.id, from);
    setFlown((prev) => new Set([...prev, ...fresh.map((r) => r.c.info.id)]));
  }, [rounds, flown]);

  // ...and once the rail has drawn it, slide it there from the middle, growing down to its size
  useLayoutEffect(() => {
    if (pending.current.size === 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [id, from] of pending.current) {
      const el = slots.current.get(id);
      pending.current.delete(id);
      if (!el || !from || still) continue;
      const to = el.getBoundingClientRect();
      if (to.width === 0) continue;
      el.style.zIndex = "60";
      const move = el.animate([{ transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` }, { transformOrigin: "top left", transform: "none" }], { duration: 640, easing: EASE });
      move.onfinish = move.oncancel = () => { el.style.zIndex = ""; };
    }
  }, [flown]);

  const reg = (id: string, el: HTMLElement | null) => { if (el) slots.current.set(id, el); else slots.current.delete(id); };
  const centre = rounds.find((r) => !flown.has(r.c.info.id));
  const openRound = open ? rounds.find((r) => r.c.info.id === open) : undefined;
  const running = rounds.filter((r) => !flown.has(r.c.info.id));

  return (
    <>
      <header className="relative z-[35] flex h-[72px] shrink-0 items-center gap-6 border-b border-line px-4">
        <ol className="flex min-w-0 items-center gap-2" aria-label="Rounds" data-testid="rail">
          {rounds.map((r) => (flown.has(r.c.info.id) && r.entry
            ? <Story key={r.c.info.id} r={r} open={open === r.c.info.id} reg={reg} onOpen={() => setOpen(open === r.c.info.id ? null : r.c.info.id)} />
            : <Waiting key={r.c.info.id} r={r} live={running[0]?.c.info.id === r.c.info.id} />))}
        </ol>
        <span className="flex-1" />
        <nav className="flex gap-6" role="tablist" aria-label="Loop views">
          <StageTab on={view === "live"} onClick={() => setView("live")}>Rounds</StageTab>
          <StageTab on={view === "results"} disabled={!a.final} title={a.final ? undefined : "Available when the loop ends"} onClick={() => setView("results")}>Results</StageTab>
        </nav>
        <StageClose onClick={onClose} />
      </header>
      {openRound && <button type="button" aria-label="Close the round" className="absolute inset-0 z-30 cursor-default" onClick={() => setOpen(null)} />}
      {openRound && <Sheet r={openRound} onClose={() => setOpen(null)} />}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`stage-${view}`}>
        <p className="px-5 pt-4 font-serif text-[19px] leading-snug text-fg" data-testid="stage-question">{a.question}</p>
        {view === "live" && (centre
          ? <Live r={centre} a={a} orbRef={big} />
          : (
            <div className="grid place-items-center gap-4 py-24 text-center" aria-live="polite">
              <UltraOrb size={72} state={a.phase === "done" ? "idle" : "thinking"} />
              <p className="text-[14px] text-fg-muted">{a.phase === "done" ? "The loop is finished." : a.phase === "writing" ? "Writing the combined outcome…" : "Choosing the next scenario…"}</p>
              {a.phaseNote && a.phase !== "done" && <p className="max-w-[48ch] text-[12.5px] text-fg-dim">{a.phaseNote}</p>}
            </div>
          ))}
        {view === "results" && a.final && <LoopResults run={run} a={a} />}
      </div>
    </>
  );
}
