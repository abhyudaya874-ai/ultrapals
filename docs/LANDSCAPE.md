# Where UltraPals sits

We did a prior-art pass before we wrote this (public repos, Devpost, Product Hunt, YC, patents, arXiv, vendor docs, 2026). The result shapes how we describe the project, so it goes first.

> **We do not claim to have invented escrow, mandates, agent wallets, dispute evidence, adversarial agent testing, or a payment state machine.** Every one of those has a close neighbour. What we claim is a *combination* and an *engineering discipline*, and we name the neighbours so you can check.

## The neighbours, by idea

| Idea | Who already does it | What they do |
|---|---|---|
| Delegated spending authority for agents | Google AP2, Visa Trusted Agent Protocol, Mastercard Agent Pay, Antom AgentSafePay, Skyfire, Payman, Crossmint, Natural | scoped credentials and mandates, limits, revocation |
| Pay-on-proof / milestone release | Milestone, Trustee, Undo (PayPal AI Hackathon repos), XRPL escrow, q402 | tests or acceptance gate a release |
| Dispute evidence and provenance | Sentinel ProofLayer, Chargeflow, Justt, Mastercard's merchant guidance | hashed evidence graphs, automated responses |
| AI that fixes a PayPal integration | PayPal Doctor (official, in `paypal/AI-Toolkit`) | static checks, optional sandbox probes, fix workflow |
| Agents that attack other agents' tool calls | Gauntlet (Elastic hackathon winner), FetchSandbox, AurumFlux | adversarial mutation, deterministic old-vs-patched proof |
| Hold/authorization lifecycle modelling | HoldSpec (arXiv, Oct 2026) | provider-specific hold lifecycles with generated conformance tests |
| Multi-rail comparison | Hyperswitch, Adyen Agentic, Stripe ACP, Checkout.com interoperability layer | routing and orchestration |

## What we think is distinctive (and what each claim rests on)

| # | Claim | Why we believe it | How to check it |
|---|---|---|---|
| 1 | **One workspace where the agent does real work *and* real sandbox money is gated by a pure function it cannot call.** | Most neighbours are either an agent with a spend limit or a rules engine with no agent. Here PromisePal drives a live browser to approve a sandbox order, then asks a route whose verdict is `computeVerdict`, which `lib/agent/**` and `lib/computer/**` are forbidden to import. | `node scripts/check-invariants.mjs` (check 6: agents never call `computeVerdict`) |
| 2 | **Not seeing is not the same as no, enforced in the type system and the test table.** | `FACT_MISSING` is WAIT for unavailable evidence, malformed numbers and wrong snapshot kinds, in every window state. | `lib/verdict.test.ts` rows marked "never RELEASE on a blind spot" |
| 3 | **Every verdict stores its own input, so anyone can replay it later against a world that has moved.** | Verdict events carry `{verdict, input}`. Vendors write frozen `condition_snapshot` rows first. | the **Replay verdict** button; `GET /api/verdict/replay?promiseId=` |
| 4 | **PayPal's rivals are examiners with a frozen roster, structure-only bars, and a rule that a rival row never gates the seal.** | Eight named SuperPals with analyst-set bars; a missing key reports `NOT_MEASURABLE`, never a pass. | `lib/pals/superpals.ts`, `lib/pals/seal.ts` |
| 5 | **Cite or die.** | A rival or a rail cell survives only if the page was fetched, the quote is a verbatim substring of it, and the operator and timestamp are the fetcher's. | `lib/pals/rival.ts` `verifyRival`, `lib/pals/situation.ts` `verifyCells` |
| 6 | **Battle and Loop turn "an agent said so" into a judged, replayable contest.** | Opposite predictions on different model families, a blind judge, a bracket whose damage is arithmetic, and a code-counted half of every score. | `lib/arena/*` (14 test files) |
| 7 | **Unattended agents with ceilings no prompt can lift.** | Eight kinds, each with its own cadence, daily cap and time limit; money and self-replication denied inside runs; a schedule needs a *time word in the user's own message*. | `lib/automations/kinds.ts`, `core.ts` |

## What we compared ourselves against, honestly

| Topic | PayPal Doctor | Gauntlet / FetchSandbox | Agent wallets (Skyfire, Crossmint, Natural) | UltraPals |
|---|---|---|---|---|
| Finds integration bugs | yes | yes | no | not the goal |
| Moves money | no (probes only) | no | yes | sandbox only, only on a verdict |
| Agent can browse, run code, research | no | partial | partial | yes, one VM |
| Spend authority is separate from the model | n/a | n/a | scoped keys | pure function the model cannot import |
| Replayable verdict | no | deterministic old/new proof | signed receipts | stored input, recompute on demand |
| Compares PayPal with rivals on the record | no | no | no | SuperPals + SituationPal |
| Multi-agent contest with a blind judge | no | no | no | Battle and Loop |

"No" means we did not find it in the public material we read. It is not a proof of absence.

## Things we are not good at (said first, so nobody has to find them)

* **Sandbox is not production.** Sandbox proves the mechanism and the state machine. It does not prove fraud reduction or conversion.
* **Rival rows are structural.** We never compare sandbox milliseconds, approval rates or fees, because those are not comparable across sandboxes.
* **Several SuperPal rows read `NOT_MEASURABLE`** until the matching sandbox key is supplied. That is by design, and the receipt names the missing key.
* **Free models are inconsistent.** That is why Battle needs different model families and why Loop shows the diff of what changed.
* **No login.** Anyone who can reach the app can use it, inside the ceilings in [`SYSTEM.md`](SYSTEM.md).
* **A fee question on the open web can come out unflattering to PayPal.** A real Battle we ran on "total fee for a $0.25 purchase" crowned a team that found PayPal's fixed fee dominates a micropayment. The product reports what the sources say, which is the point of a cite-or-die exam.
