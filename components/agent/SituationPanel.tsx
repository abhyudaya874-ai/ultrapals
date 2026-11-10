"use client";
import { Disclosure } from "@/components/ui/Disclosure";
import { CHECKS, CHECK_LABEL, type Outcome } from "@/lib/pals/probe";
import { needWords, railName, type RailId, type SituationCard, type Support } from "@/lib/pals/situation";

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

/** Ranked fit with its honest band, a rails-by-needs grid of cited answers, and the real sandbox checks. Every number comes from the card. */
export function SituationPanel({ card }: { card: SituationCard }) {
  const h = card.rails.length * ROW;
  const sources = card.cells.map((c) => ({ ...c, name: railName(c.rail) }));
  return (
    <section className="space-y-3 rounded-card bg-surface p-3.5" data-testid="situation-card" aria-label="Situation comparison">
      <p className="text-[13px] text-fg-muted">
        {card.needs.map((n) => `${needWords(n.need)} (${n.weight})`).join(" · ")}
        {card.needsDefaulted && <span className="text-warn"> · defaulted: no model could read the idea</span>}
      </p>

      <figure className="space-y-1" data-testid="situation-rank">
        <figcaption className="text-[12.5px] text-fg-dim">Fit for your idea. The bar is what is cited today; the pale extension is the most it could be if every unanswered need were fully supported.</figcaption>
        <svg viewBox={`0 0 ${LABEL_W + TRACK + 110} ${h}`} role="img" aria-label="Ranked fit with uncertainty band" className="w-full max-w-[460px]">
          {card.rails.map((r, i) => (
            <g key={r.rail} transform={`translate(0 ${i * ROW})`}>
              <text x={0} y={18} fontSize={12} fill={i === 0 ? "var(--color-fg)" : "var(--color-fg-muted)"}>{i + 1}. {railName(r.rail)}</text>
              <rect x={LABEL_W} y={7} width={TRACK} height={14} rx={3} fill="var(--color-surface-2)" />
              <rect x={LABEL_W} y={7} width={r.upper * TRACK} height={14} rx={3} fill="var(--color-accent)" opacity={0.28} />
              <rect x={LABEL_W} y={7} width={Math.max(r.fit * TRACK, 0)} height={14} rx={3} fill="var(--color-accent)" />
              <text x={LABEL_W + TRACK + 8} y={18} fontSize={11} fill="var(--color-fg-dim)">{pct(r.fit)}–{pct(r.upper)} · {pct(r.known)} known</text>
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
                <tr key={r.rail} className="border-t border-line">
                  <td className="py-1 pr-2 text-fg">{railName(r.rail)}</td>
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
              <tr className="text-left text-fg-dim"><th className="py-1 pr-2 font-normal">Check</th>{PROBE_RAILS.map((r) => <th key={r} className="px-1 py-1 font-normal">{railName(r)}</th>)}</tr>
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
      <p className="text-[12px] text-fg-dim">{card.unknown} (rail, need) pairs still have no cited answer. Fit is today&apos;s published support weighted by your idea; the future is an inference from what each rail publishes, not a forecast.</p>
    </section>
  );
}
