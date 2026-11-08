"use client";
import { useState } from "react";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { IconArrowUp } from "@/components/ui/icons";

type Kind = "none" | "price_at_most" | "page_contains";

const pill = "h-9 rounded-full border border-line bg-canvas px-3 text-[14px] outline-none focus:border-dock-line";

export function Composer() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("none");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // double-submit guard; the server is idempotent anyway
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const condition =
      kind === "price_at_most"
        ? { kind, query: s("query"), ceiling: s("ceiling") }
        : kind === "page_contains"
          ? { kind, url: s("url"), needle: s("needle") }
          : { kind };
    try {
      const res = await fetch("/api/promise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "create",
          title: s("title"),
          amount: s("amount"),
          currency: s("currency") || "USD",
          windowMinutes: Number(s("windowMinutes") || 10),
          payerName: s("payerName") || undefined,
          payerEmail: s("payerEmail") || undefined,
          condition,
        }),
      });
      const json = (await res.json()) as { promiseId?: string; error?: string };
      if (!res.ok || !json.promiseId) throw new Error(json.error ?? "could not create the promise");
      window.location.href = `/p?id=${json.promiseId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not create the promise");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} data-testid="composer" className="rounded-dock border border-dock-line bg-dock p-3">
      <textarea name="title" required rows={2} placeholder="What are you promising?"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
        className="min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-[16px] outline-none placeholder:text-fg-dim" />
      <div className="flex flex-wrap items-center gap-2">
        <input name="amount" inputMode="decimal" placeholder="Amount, e.g. 10.00" required aria-label="Amount" className={`${pill} w-32`} />
        <select name="currency" defaultValue="USD" aria-label="Currency" className={pill}>
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input name="windowMinutes" type="number" min={1} defaultValue={10} aria-label="Window in minutes" title="Window in minutes" placeholder="10m" className={`${pill} w-24`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Condition" className={pill}>
          <option value="none">Capture as soon as the payer approves</option>
          <option value="price_at_most">…and a product price is at or below a ceiling (Channel3)</option>
          <option value="page_contains">…and a web page contains some text (KERNEL)</option>
        </select>
        <input name="payerName" placeholder="Payer name" aria-label="Payer name" className={`${pill} w-32`} />
        <input name="payerEmail" type="email" placeholder="Payer email" aria-label="Payer email" className={`${pill} w-44`} />
        <button type="submit" disabled={busy} aria-label={busy ? "Creating" : "Commit promise"}
          className="ml-auto grid size-10 shrink-0 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted">
          {busy
            ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <IconArrowUp className="size-5" />}
        </button>
      </div>
      {kind === "price_at_most" && (
        <>
          <p className="px-2 pt-2 text-[12px] text-fg-dim">
            PayPal cannot process INR, so promises are in USD, EUR, GBP, CAD, AUD or JPY. Use a product sold in the same currency as the promise,
            or the verdict will wait with CURRENCY_MISMATCH.
          </p>
          <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
            <input name="query" placeholder="Product, e.g. Nike Pegasus 41" required aria-label="Product query" className={`${pill} min-w-48 flex-1`} />
            <input name="ceiling" inputMode="decimal" placeholder="Ceiling, e.g. 120.00" required aria-label="Price ceiling" className={`${pill} w-32`} />
          </div>
        </>
      )}
      {kind === "page_contains" && (
        <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
          <input name="url" type="url" placeholder="https://…" required aria-label="Page URL" className={`${pill} min-w-48 flex-1`} />
          <input name="needle" placeholder="Text that must appear" required aria-label="Text that must appear" className={`${pill} w-44`} />
        </div>
      )}
      {error && <p className="px-2 pt-2 text-bad">{error}</p>}
    </form>
  );
}
