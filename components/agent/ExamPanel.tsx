"use client";
import { Disclosure } from "@/components/ui/Disclosure";
import { ExamChart } from "./ExamChart";
import { SiteChip } from "@/components/ui/SiteChip";
import type { RowStatus } from "@/lib/pals/ladder";
import type { ExamCard } from "@/lib/pals/card";
import type { Seal } from "@/lib/pals/seal";

const SEAL: Record<Seal, string> = { SEALED: "bg-ok/15 text-ok", CONDITIONAL: "bg-warn/15 text-warn", REFUSED: "bg-bad/15 text-bad" };
const ROW: Record<RowStatus, { label: string; tone: string }> = {
  BAR_MET: { label: "met", tone: "text-ok" },
  BAR_MISSED: { label: "missed", tone: "text-bad" },
  NOT_MEASURABLE: { label: "not measurable", tone: "text-warn" },
  NOT_APPLICABLE: { label: "n/a", tone: "text-fg-dim" },
};
const CONF = { high: "text-ok", medium: "text-warn", low: "text-fg-dim" } as const;

/** The exam receipt: the seal, one row per examined axis, the attacks the judge faced, and every rival with its cited sources. */
export function ExamPanel({ card }: { card: ExamCard }) {
  const survived = card.attacks.run.filter((a) => a.survived).length;
  return (
    <section className="space-y-2 rounded-card bg-surface p-3.5" data-testid="exam-card" aria-label="Exam result">
      <div className="flex items-center gap-2">
        <span data-testid="exam-seal" className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${SEAL[card.seal.seal]}`}>{card.seal.seal}</span>
        <span className="min-w-0 truncate text-[13px] text-fg-muted">{card.seal.reason}</span>
      </div>

      <ul className="divide-y divide-line text-[13px]" data-testid="exam-rows">
        {card.rows.map((r) => (
          <li key={r.archetype} className="flex items-baseline gap-2 py-1.5">
            <span className="w-24 shrink-0 text-fg">{r.archetype}</span>
            <span className="min-w-0 flex-1 truncate text-fg-dim">
              {r.observed === null ? r.note ?? "no measurement" : `${r.metric.replace(/_/g, " ")}: ${r.observed} (bar ≤ ${r.bar.value}, ${r.bar.provenance})`}
            </span>
            <span className={`shrink-0 ${ROW[r.status].tone}`}>{ROW[r.status].label}</span>
          </li>
        ))}
      </ul>
      <ExamChart card={card} />
      {card.seal.liveConditions.length > 0 && <p className="text-[12.5px] text-warn">Held live at runtime: {card.seal.liveConditions.join(", ")}</p>}
      {card.measuredFrom.length > 0 && <p className="text-[12.5px] text-fg-dim" data-testid="exam-measured">Measured from the real promise run: {card.measuredFrom.join(", ")}</p>}

      <Disclosure label={`SuperPals: the rival delta (${card.superpals.filter((s) => s.status === "BAR_MET").length}/${card.superpals.length} met)`} testId="superpals">
        <ul className="space-y-1.5 pb-2 pl-1 text-[12.5px]" data-testid="superpal-rows">
          {card.superpals.map((s) => (
            <li key={s.pal.id} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 text-fg">{s.pal.name}</span>
              <span className="min-w-0 flex-1 truncate text-fg-dim">{s.observed === null ? s.note ?? s.pal.edge : `${s.pal.metric.replace(/_/g, " ")}: ${s.observed} (bar ${s.pal.op} ${s.pal.value})`}</span>
              <span className={`shrink-0 ${ROW[s.status].tone}`}>{ROW[s.status].label}</span>
              {s.evidence && (
                <SiteChip url={s.evidence.url} title={s.evidence.quote} />
              )}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure label={`Attacks on the judge: ${survived}/${card.attacks.run.length} survived`} meta={card.attacks.skipped.length ? `${card.attacks.skipped.length} guarded elsewhere` : undefined}>
        <ul className="space-y-0.5 pb-2 pl-1 text-[12.5px]">
          {card.attacks.run.map((a) => (
            <li key={a.mutation} className="flex gap-2">
              <span className={a.survived ? "text-ok" : "text-bad"}>{a.survived ? "survived" : "BROKE"}</span>
              <span className="text-fg-muted">{a.mutation}</span>
              <span className="text-fg-dim">→ {a.got}</span>
            </li>
          ))}
          {card.attacks.skipped.map((s) => (
            <li key={s.mutation} className="text-fg-dim">{s.mutation}: {s.why}</li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure label={`${card.rivals.length} rival${card.rivals.length === 1 ? "" : "s"}, every quote checked`} meta={`${card.pages} pages · ${card.rejected} rejected`}>
        <ul className="space-y-2.5 pb-2 pl-1">
          {card.rivals.map((e) => (
            <li key={`${e.rival.archetype}-${e.rival.failureClass}`} className="text-[12.5px]" data-testid="exam-rival">
              <p className="text-fg">
                {e.rival.failureClass} <span className="text-fg-dim">· {e.rival.archetype} · {e.rival.thesisOwner}</span>
              </p>
              <p className="text-fg-dim">
                attack {e.rival.attack} → counter {e.rival.counter.capability} · <span className={CONF[e.confidence]}>{e.confidence} confidence</span>{e.stale && " · stale"}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {e.rival.sources.map((s) => (
                  <li key={s.url} className="truncate text-fg-dim">
                    <SiteChip url={s.url} title={s.quote} /> <span className="italic">“{s.quote}”</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}
