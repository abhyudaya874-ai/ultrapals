"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BattleOrb, FlatOrb } from "@/components/orbs/Orbs";
import { lookFor } from "@/components/orbs/palette";
import { HoverCard } from "@/components/ui/HoverCard";
import { resolve, type Match, type Slot } from "@/lib/arena/bracket";
import { unjudgedNote } from "@/lib/arena/explain";
import type { ArenaState } from "@/lib/computer/run";
import { DIMENSIONS, type MatchResult } from "@/lib/arena/types";

type Names = Record<string, string>;
const CARD_W = 228;

/** Why one match went the way it did: the headline, what carried the winner, what cost the loser, and every hit with its numbers. */
export function MatchWhy({ m, names }: { m: MatchResult; names: Names }) {
  const d = m.duel;
  const w = names[m.winner];
  const l = m.loser ? names[m.loser] : "";
  if (m.bye || !d || !m.why) return <p className="text-[13px] text-fg-muted">{w} had no opponent in this round and goes straight through.</p>;
  const a = names[m.a ?? ""];
  const b = names[m.b ?? ""];
  return (
    <div className="space-y-3" data-testid="match-why">
      <p className="text-[13.5px] font-medium leading-snug text-fg">{m.why.headline}</p>
      <section>
        <h4 className="text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">Why {w} went through</h4>
        <ul className="mt-1 space-y-0.5 text-[12.5px] leading-snug text-fg-muted">{m.why.winner.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section>
        <h4 className="text-[11.5px] uppercase tracking-[0.12em] text-fg-dim">Why {l} went out</h4>
        <ul className="mt-1 space-y-0.5 text-[12.5px] leading-snug text-fg-muted">{m.why.loser.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      {d.hits.length > 0 && (
        <table className="w-full text-[12px] tabular-nums">
          <thead><tr className="text-left text-fg-dim"><th className="pb-1 font-normal">Judged on</th><th className="pb-1 text-right font-normal">{a.split(" ")[0]}</th><th className="pb-1 text-right font-normal">{b.split(" ")[0]}</th><th className="pb-1 text-right font-normal">Damage</th></tr></thead>
          <tbody className="text-fg-muted">
            {DIMENSIONS.map((dim) => {
              const h = d.hits.find((x) => x.dim === dim);
              return h
                ? <tr key={dim}><td className="py-0.5 capitalize">{dim}</td><td className={`text-right ${h.by === "a" ? "text-fg" : ""}`}>{h.scoreA}</td><td className={`text-right ${h.by === "b" ? "text-fg" : ""}`}>{h.scoreB}</td><td className="text-right">{h.dealt}</td></tr>
                : <tr key={dim} className="text-fg-dim"><td className="py-0.5 capitalize">{dim}</td><td className="text-right" colSpan={3}>level</td></tr>;
            })}
          </tbody>
        </table>
      )}
      <p className="text-[12px] leading-snug text-fg-dim">{unjudgedNote(m)}</p>
    </div>
  );
}

function Row({ slot, id, names, hp, result, feeder }: { slot: Slot; id: string | null; names: Names; hp: number; result?: MatchResult; feeder?: string }) {
  if (!id) return <div className="flex h-8 items-center px-3 text-[12.5px] text-fg-dim">{feeder ? `Winner of ${feeder}` : slot.from && "seed" in slot.from ? "Bye" : "To be decided"}</div>;
  const played = !!result && !result.bye;
  const won = played && result.winner === id;
  const out = played && result.loser === id;
  const look = lookFor(id, "battle");
  return (
    <div className={`flex h-8 items-center gap-2 px-3 transition-opacity ${out ? "opacity-55" : ""}`}>
      <FlatOrb size={20} look={look} mood={out ? "error" : "idle"} interactive={false} />
      <span className={`min-w-0 flex-1 truncate text-[13px] ${won ? "font-medium text-fg" : "text-fg-muted"}`}>{names[id]}</span>
      <span className="w-14 shrink-0" aria-hidden>
        <span className="block h-[2px] overflow-hidden rounded-full bg-line"><span className={`block h-full rounded-full ${hp < 25 ? "bg-bad" : "bg-fg-muted"}`} style={{ width: `${Math.max(0, Math.min(100, hp))}%`, transition: "width 400ms cubic-bezier(0.2, 0.8, 0.2, 1)" }} /></span>
      </span>
      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-fg-dim">{Math.round(hp)}</span>
    </div>
  );
}

function Card({ m, result, names, hp, feeders, reg }: { m: Match; result?: MatchResult; names: Names; hp: Record<string, number>; feeders: Record<string, string>; reg: (id: string, el: HTMLElement | null) => void }) {
  const hpOf = (id: string | null, side: "a" | "b") => (id ? (result?.hpAfter ? result.hpAfter[side] : hp[id] ?? 100) : 100);
  const feeder = (s: Slot) => ("winnerOf" in s.from ? feeders[s.from.winnerOf] : "loserOf" in s.from ? `the loser of ${feeders[s.from.loserOf]}` : undefined);
  const body = (
    <div ref={(el) => reg(m.id, el)} data-testid="match" data-match={m.id} data-played={!!result} tabIndex={result ? 0 : -1} style={{ width: CARD_W }}
      className={`rounded-xl border bg-surface transition-colors ${result && !result.bye ? "border-line hover:border-dock-line focus-visible:border-dock-line" : "border-line/70"}`}>
      <Row slot={m.a} id={m.a.id} names={names} hp={hpOf(m.a.id, "a")} result={result} feeder={feeder(m.a)} />
      <div className="h-px bg-line" />
      <Row slot={m.b} id={m.b.id} names={names} hp={hpOf(m.b.id, "b")} result={result} feeder={feeder(m.b)} />
    </div>
  );
  return result ? <HoverCard card={<MatchWhy m={result} names={names} />} width={344} side="right" maxHeight={520} className="block">{body}</HoverCard> : body;
}

/**
 * The knockout as a bracket: rounds from left to right, thin lines from each match to the one the winner plays next, and a card on every
 * played match that explains the result when you point at it. Health sits beside each name and carries over to the next round.
 */
export function Bracket({ arena, names }: { arena: ArenaState; names: Names }) {
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<{ id: string; d: string; done: boolean }[]>([]);
  const results = useMemo(() => arena.matches.map((m) => ({ matchId: m.id, winner: m.winner })), [arena.matches]);
  const view = useMemo(() => (arena.bracket ? resolve(arena.bracket, results) : null), [arena.bracket, results]);
  const played = useMemo(() => new Map(arena.matches.map((m) => [m.id, m])), [arena.matches]);
  const feeders = useMemo(() => Object.fromEntries((view ? [...view.rounds.flat(), ...(view.third ? [view.third] : [])] : []).map((m) => [m.id, m.label === "Final" ? "the final" : m.label.toLowerCase() + (m.index >= 0 ? ` ${m.index + 1}` : "")])), [view]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !view) return;
    const draw = () => {
      const o = el.getBoundingClientRect();
      const out: typeof lines = [];
      for (const m of view.rounds.flat()) {
        const to = cards.current.get(m.id)?.getBoundingClientRect();
        for (const s of [m.a, m.b]) {
          if (!("winnerOf" in s.from)) continue;
          const fr = cards.current.get(s.from.winnerOf)?.getBoundingClientRect();
          if (!fr || !to) continue;
          const [x1, y1, x2, y2] = [fr.right - o.left, fr.top + fr.height / 2 - o.top, to.left - o.left, to.top + to.height / 2 - o.top];
          const xm = x1 + (x2 - x1) / 2;
          out.push({ id: `${s.from.winnerOf}>${m.id}`, d: `M${x1} ${y1}H${xm}V${y2}H${x2}`, done: played.has(s.from.winnerOf) });
        }
      }
      setLines(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, played]);

  if (!view) return <p className="text-[13px] text-fg-dim">The bracket appears when the teams are set.</p>;
  const reg = (id: string, el: HTMLElement | null) => { if (el) cards.current.set(id, el); else cards.current.delete(id); };
  const champ = arena.final?.winner ? arena.contenders.find((c) => c.info.id === arena.final!.winner) : null;
  const common = { names, hp: arena.hp, feeders, reg };
  return (
    <div className="overflow-x-auto" data-testid="bracket">
      <div ref={box} className="relative flex min-w-max items-stretch gap-14 px-1 py-2">
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {lines.map((l) => <path key={l.id} d={l.d} fill="none" strokeWidth={1} className={l.done ? "stroke-fg-dim" : "stroke-line"} />)}
        </svg>
        {view.rounds.map((round, r) => (
          <div key={r} className="flex flex-col">
            <h3 className="mb-3 text-[11.5px] uppercase tracking-[0.14em] text-fg-dim">{round[0]?.label}</h3>
            <div className="flex flex-1 flex-col justify-around gap-5">
              {round.map((m) => <Card key={m.id} m={m} result={played.get(m.id)} {...common} />)}
              {r === view.rounds.length - 1 && view.third && (
                <div className="mt-8">
                  <h3 className="mb-3 text-[11.5px] uppercase tracking-[0.14em] text-fg-dim">Third place</h3>
                  <Card m={view.third} result={played.get(view.third.id)} {...common} />
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="flex flex-col">
          <h3 className="mb-3 text-[11.5px] uppercase tracking-[0.14em] text-fg-dim">Champion</h3>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4" data-testid="champion">
            {champ ? (<><BattleOrb id={champ.info.id} size={64} state="ok" tool={champ.info.tool} winner /><p className="text-[14px] font-medium text-fg">{champ.info.name}</p></>) : <p className="text-[12.5px] text-fg-dim">Decided in the final</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
