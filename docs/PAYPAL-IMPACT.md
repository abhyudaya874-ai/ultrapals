# What this could be worth to PayPal

This is a sensitivity model, not a forecast. Every input is either a published PayPal figure (cited) or a labelled assumption you can change. The arithmetic is reproducible in one command at the bottom.

## The honest headline

* **Billions are at stake. Billions are not what this one project captures.**
* The *pool* an agent-commerce trust layer defends is on the order of **$0.15B to $1.55B of transaction margin a year** (depending on how much of PayPal's volume becomes agent-initiated), plus a **$1.25B a year** transaction-loss line it can nibble at.
* The *attributable* share of that, under deliberately modest assumptions, is **tens to a few hundred million dollars a year**. That is still a large number for something that costs a few free-tier API calls to run, and it is the number we would defend.

## Anchors (PayPal's own reported figures, FY2025)

| Input | Value | Source |
|---|---|---|
| Total payment volume (TPV) | **$1.79 trillion**, +7% | [PayPal FY2025 results via TradingView](https://www.tradingview.com/news/tradingview:2fde1793f4ab6:0-paypal-reports-fourth-quarter-and-full-year-2025-results) |
| Transaction margin dollars (TM$) | **$15.5 billion**, +6% | [PayPal Q4 2025 IR newsletter](https://s205.q4cdn.com/875401827/files/doc_financials/2025/q4/IR-Newsletter-PYPL-4Q-25-Earnings.pdf) |
| Active accounts | 439 million | same TradingView summary |
| Transaction losses | about **0.07% of TPV** (protection claims, fraud, chargebacks) | [chargeback.io summary of PayPal's FY2025 report](https://www.chargeback.io/it/blog/paypal-statistics), a secondary source |
| TM$ per dollar of TPV | **0.866%** | derived: 15.5 / 1790 |
| Transaction losses in dollars | **about $1.25B** | derived: 0.07% x $1.79T |

What management itself said, so this model starts where PayPal starts:

> "Transaction margin dollar growth is our North Star." - management, Q3 2026 call ([transcript](https://tickertrends.io/transcripts/PYPL/Q3-earnings-transcript-2026))
> agentic commerce "won't materially impact 2026 growth" - Jamie Miller (then interim CEO), prepared remarks, Q4 2025 call, 3 Feb 2026 ([transcript](https://www.fool.com/earnings/call-transcripts/2026/02/03/paypal-pypl-q4-2025-earnings-call-transcript/))
> merchants "require much more hands-on integration support than we anticipated" - same remarks, about branded checkout adoption
(All three checked against the published transcripts on 11 Nov 2026. The Q4 2025 transcript text is machine-transcribed and garbles the word "agentic"; the quoted words are as printed.)
Read together: PayPal wants margin, not volume, it expects agent commerce to be small *this* year, and it has already learned that "great product" does not mean "fast adoption". A trust layer that makes agent commerce *safe to turn on* is aimed at exactly that gap.

## Pool 1: agent-initiated volume that has to choose a rail

If a share `s` of PayPal's volume becomes agent-initiated, the transaction margin riding on it is `TPV x s x 0.866%`. Agent flows may carry a different margin than checkout; 0.866% is the blended rate and the cleanest neutral assumption.

| Agent share of today's TPV | Volume | Transaction margin riding on it |
|---|---|---|
| 1% | $17.9B | **$155M** |
| 3% | $53.7B | **$465M** |
| 5% | $89.5B | **$775M** |
| 10% | $179B | **$1.55B** |

This pool is *defended*, not *created*. The question for a merchant or an agent builder is "which rail can I let an agent spend on without being able to prove what it was allowed to do?" Stripe, Visa, Mastercard, Google and Adyen are all answering it. Whichever rail makes the answer easiest to verify keeps the margin.

## Pool 2: transaction losses

| Relative reduction in the ~$1.25B loss line | Annual value |
|---|---|
| 1% | **$12.5M** |
| 5% | **$62.6M** |
| 10% | **$125.3M** |

Where the mechanism could act: a refund or capture that happens when the condition was not met is a loss; a verdict that cannot move money on missing evidence (`FACT_MISSING` is always WAIT) removes that class by construction. This research did **not** measure how much of the loss line is that class, so treat the table as a unit price, not a claim.

## Attributable value

`attributable = TPV x s x 0.866% x k`, where `k` is the fraction of the defended margin that is *retained because a verifiable trust layer exists*.

| Agent share `s` | k = 5% | k = 10% | k = 20% |
|---|---|---|---|
| 3% | $23M | $47M | $93M |
| 5% | $39M | **$78M** | $155M |
| 10% | $78M | $155M | **$310M** |

A conservative planning case is `s = 5%`, `k = 10%`: **about $78M a year of retained margin**, plus **$12 to $63M** from a 1% to 5% cut in losses. Together, **roughly $90M to $140M a year**. The optimistic corner is above $300M. None of this assumes new users; it assumes PayPal keeps volume it would otherwise route elsewhere.

## Where the value would actually come from

| Mechanism in the product | PayPal benefit | KPI to test it with |
|---|---|---|
| Verdict is pure code and replays byte for byte | A merchant or auditor can re-check any capture or release without trusting a vendor | replay requests per dispute; share of disputes closed on the replay |
| "Could not see" is WAIT, never RELEASE | No money moves on a blind spot | captures/refunds with missing evidence (target: zero) |
| Evidence is frozen before the verdict | The record a dispute needs already exists | time to assemble evidence for a disputed capture |
| Deal exam with a seal (SEALED / CONDITIONAL / REFUSED) | Weak deal designs are caught before they ship | share of designs refused or conditioned before launch |
| SuperPals put PayPal's capabilities next to eight rivals, with sources | Integrators see where PayPal wins and loses, on the record | rows where PayPal meets the bar; rows that become roadmap items |
| Battle / Loop make agents earn an answer | Higher-quality research per run, with the disagreement visible | judge score vs single-agent baseline on the same questions |
| Automations with hard ceilings | Unattended agent work is safe enough to leave on | unattended runs completed vs blocked |

## What this does not claim

* It does not claim agent commerce will reach 5% or 10% of PayPal's TPV. That is an input, and PayPal's management said on its Q4 2025 call that it would not materially affect 2026 growth.
* It does not claim the sandbox demonstrates production loss reduction. Sandbox proves the mechanism works; it does not measure real fraud.
* It does not claim `k`. `k` is the number a pilot would measure. A 10% retained share is an assumption, and the table shows 5% and 20% beside it.
* Dispute and loss figures come from a secondary summary of PayPal's report. Check the primary 10-K before quoting them externally.

## Reproduce it

```bash
node -e '
const TPV=1790e9, TM=15.5e9, loss=0.0007*TPV, rate=TM/TPV;
for (const s of [0.01,0.03,0.05,0.10]) console.log("share",s,"TM $M",(TPV*s*rate/1e6).toFixed(0));
for (const r of [0.01,0.05,0.10]) console.log("loss cut",r,"$M",(loss*r/1e6).toFixed(1));
for (const s of [0.03,0.05,0.10]) for (const k of [0.05,0.10,0.20]) console.log("s",s,"k",k,"$M",(TPV*s*rate*k/1e6).toFixed(1));
'
```
