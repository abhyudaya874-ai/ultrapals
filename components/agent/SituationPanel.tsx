"use client";
import { useEffect, useMemo, useState } from "react";
import { Disclosure } from "@/components/ui/Disclosure";
import { CHECKS, CHECK_LABEL, type Outcome } from "@/lib/pals/probe";
import { REASON_TEXT, judgeRecommendation, type Outcome as Verdict } from "@/lib/pals/recommend";
import { needWords, type RailId, type SituationCard, type Support } from "@/lib/pals/situation";

const LABEL_W = 104;
const TRACK = 240;
const ROW = 28;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const MARK: Record<Support | "unknown", { glyph: string; word: string; tone: string }> = {
  yes: { glyph: "●", word: "supported", tone: "text-ok" },
  partial: { glyph: "◐", word: "partly", tone: "text-warn" },
  no: { glyph: "○", word: "not supported", tone: "text-bad" },
  unknown: { glyph: "?", word: "no cited answer", tone: "text-fg-dim" },
};
const OUT: Record<Outcome, { word: string; tone: string }> = { pass: { word: "pass", tone: "text-ok" }, fail: { word: "fail", tone: "text-bad" }, not_measurable: { word: "not measurable", tone: "text-warn" } };
const PROBE_RAILS: RailId[] = ["paypal", "stripe", "square"];
const OUTCOME: Record<Verdict, string> = { APPROVE: "bg-ok/15 text-ok", HOLD: "bg-warn/15 text-warn", FLAG: "bg-bad/15 text-bad" };
const nameOf = (card: SituationCard, id: string): string => card.rails.find((r) => r.rail === id)?.name ?? id;

/** The person's sign-off. Kept in THIS browser only (localStorage): it is a marker on the receipt, not a server record. */
function useSignoff(receiptId: string | undefined) {
  const key = `sp-signoff-${receiptId ?? "none"}`;
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    try { setAt(localStorage.getItem(key)); } catch { setAt(null); }
  }, [key]);
  const sign = () => {
    const t = new Date().toISOString();
    try { localStorage.setItem(key, t); } catch { /* private mode: the marker simply does not persist */ }
    setAt(t);
  };
  return { at, sign };
}

/** Ranked fit with its honest band, a rails-by-needs grid of cited answers, and the real sandbox checks. Every number comes from the card. */
export function SituationPanel({ card }: { card: SituationCard }) {
  const h = card.rails.length * ROW;
  const sources = card.cells.map((c) => ({ ...c, name: nameOf(card, c.rail) }));
  const rubric = card.rubric;
  const out = useMemo(() => new Set(rubric?.contenders ?? card.rails.map((r) => r.rail)), [rubric, card.rails]);
  // Replay in the browser: the same pure rubric over the same card must give the same outcome and reasons.
  const replay = useMemo(() => (rubric ? JSON.stringify(judgeRecommendation(card, card.blind ?? null)) === JSON.stringify(rubric) : null), [card, rubric]);
  const { at, sign } = useSignoff(card.receipt?.id);
  return (
    <section className="space-y-3 rounded-card bg-surface p-3.5" data-testid="situation-card" aria-label="Situation comparison">
      {rubric && (
        <div className="space-y-1.5" data-testid="case-desk">
          <div className="flex items-center gap-2">
            <span data-testid="case-outcome" className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${OUTCOME[rubric.outcome]}`}>{rubric.outcome}</span>
            <span className="min-w-0 truncate text-[13px] text-fg">{rubric.leader ? `Leader: ${nameOf(card, rubric.leader)}` : "No leader"}</span>
          </div>
          <ul className="space-y-0.5 text-[12.5px] text-fg-muted">
            {rubric.reasons.map((r) => <li key={r}>• {REASON_TEXT[r]}</li>)}
          </ul>
          {card.blind && <p className="text-[12.5px] text-fg-dim">Blind check: a {card.blind.family} model, shown only the grid, picked {nameOf(card, card.blind.pick)}{card.blind.concern ? ` (its concern: ${card.blind.concern})` : ""}.</p>}
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-dim">
            {card.receipt && <span title={card.receipt.id}>Receipt {card.receipt.id.slice(0, 10)}</span>}
            {replay !== null && <span className={replay ? "text-ok" : "text-bad"} data-testid="replay">{replay ? "✓ recomputed here, same outcome" : "✗ replay differs"}</span>}
            {at ? <span data-testid="signed">Confirmed by you · {at.slice(0, 16).replace("T", " ")} · this browser only</span> : (
              <button type="button" onClick={sign} data-testid="confirm" className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px] text-fg hover:bg-black/30">I confirm this recommendation</button>
            )}
          </div>
        </div>
      )}
      <p className="text-[13px] text-fg-muted">
        {card.needs.map((n) => `${needWords(n.need)} (${n.weight})`).join(" · ")}
        {card.needsDefaulted && <span className="text-warn"> · defaulted: no model could read the idea</span>}
      </p>

      <figure className="space-y-1" data-testid="situation-rank">
        <figcaption className="text-[12.5px] text-fg-dim">Fit for your idea. The bar is what is cited today; the pale extension is the most it could be if every unanswered need were fully supported.</figcaption>
        <svg viewBox={`0 0 ${LABEL_W + TRACK + 110} ${h}`} role="img" aria-label="Ranked fit with uncertainty band" className="w-full max-w-[460px]">
          {card.rails.map((r, i) => (
            <g key={r.rail} transform={`translate(0 ${i * ROW})`}>
              <g opacity={out.has(r.rail) ? 1 : 0.45}>
              <text x={0} y={18} fontSize={12} fill={i === 0 ? "var(--color-fg)" : "var(--color-fg-muted)"}>{i + 1}. {r.name}</text>
              <rect x={LABEL_W} y={7} width={TRACK} height={14} rx={3} fill="var(--color-surface-2)" />
              <rect x={LABEL_W} y={7} width={r.upper * TRACK} height={14} rx={3} fill="var(--color-accent)" opacity={0.28} />
              <rect x={LABEL_W} y={7} width={Math.max(r.fit * TRACK, 0)} height={14} rx={3} fill="var(--color-accent)" />
              <text x={LABEL_W + TRACK + 8} y={18} fontSize={11} fill="var(--color-fg-dim)">{pct(r.fit)}–{pct(r.upper)} · {pct(r.known)} known{out.has(r.rail) ? "" : " · out"}</text>
              </g>
            </g>
          ))}
        </svg>
      </figure>

      <figure className="space-y-1" data-testid="situation-grid">
        <figcaption className="text-[12.5px] text-fg-dim">What each rail publishes, per need. ? means no cited page said, which is not the same as no.</figcaption>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-fg-dim">
                <th className="py-1 pr-2 font-normal">Rail</th>
                {card.needs.map((n) => <th key={n.need} className="px-1 py-1 text-center font-normal" title={needWords(n.need)}>{n.need.replace(/_/g, " ")}</th>)}
              </tr>
            </thead>
            <tbody>
              {card.rails.map((r) => (
                <tr key={r.rail} className={`border-t border-line ${out.has(r.rail) ? "" : "opacity-50"}`}>
                  <td className="py-1 pr-2 text-fg">{r.name}</td>
                  {r.parts.map((p) => (
                    <td key={p.need} className={`px-1 py-1 text-center ${MARK[p.support].tone}`} title={MARK[p.support].word}>
                      <span aria-label={MARK[p.support].word}>{MARK[p.support].glyph}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>

      <Disclosure label="Sandbox checks (real calls to each test environment)" meta={`${card.probes.filter((p) => p.outcome === "pass").length}/${card.probes.length} pass`} testId="situation-probes">
        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-fg-dim"><th className="py-1 pr-2 font-normal">Check</th>{PROBE_RAILS.map((r) => <th key={r} className="px-1 py-1 font-normal">{nameOf(card, r)}</th>)}</tr>
            </thead>
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c} className="border-t border-line align-top">
                  <td className="py-1 pr-2 text-fg-muted">{CHECK_LABEL[c]}</td>
                  {PROBE_RAILS.map((r) => {
                    const p = card.probes.find((x) => x.rail === r && x.check === c);
                    return <td key={r} className={`px-1 py-1 ${p ? OUT[p.outcome].tone : "text-fg-dim"}`} title={p?.detail}>{p ? OUT[p.outcome].word : "not run"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-1 text-[12px] text-fg-dim">Structure only, in test and sandbox environments. PayPal is checked read-only: the agent holds no PayPal write tool, so what needs a write says why it was not measured.</p>
        </div>
      </Disclosure>

      <Disclosure label={`${sources.length} cited answers`} meta={`${card.rounds} round${card.rounds === 1 ? "" : "s"} · ${card.searches} searches · stopped: ${card.stop.replace(/_/g, " ")}`} testId="situation-sources">
        <ul className="space-y-1.5 pb-2 pl-1 text-[12.5px]">
          {sources.map((s) => (
            <li key={`${s.rail}-${s.need}`} className="text-fg-dim">
              <span className="text-fg">{s.name}</span> · {s.need.replace(/_/g, " ")} · <span className={MARK[s.support].tone}>{MARK[s.support].word}</span>{" "}
              <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-fg">{new URL(s.url).hostname.replace(/^www\./, "")}</a> <span className="italic">“{s.quote}”</span>
            </li>
          ))}
          {sources.length === 0 && <li className="text-fg-dim">No page could be cited for any pair, so every fit above is a wide band.</li>}
        </ul>
      </Disclosure>
      {card.discovered.length > 0 && (
        <Disclosure label={`${card.discovered.length} rail${card.discovered.length === 1 ? "" : "s"} found beyond the usual nine`} testId="situation-discovered">
          <ul className="space-y-1 pb-2 pl-1 text-[12.5px] text-fg-dim">
            {card.discovered.map((d) => (
              <li key={d.id}><span className="text-fg">{d.name}</span> · <a href={d.url} target="_blank" rel="noreferrer" className="hover:text-fg">{new URL(d.url).hostname.replace(/^www\./, "")}</a> <span className="italic">“{d.quote}”</span></li>
            ))}
          </ul>
        </Disclosure>
      )}
      <p className="text-[12px] text-fg-dim">{card.unknown} (rail, need) pairs still have no cited answer. Fit is today&apos;s published support weighted by your idea; the future is an inference from what each rail publishes, not a forecast.</p>
    </section>
  );
}
