# DECISIONS: choices that differ from the original rule text, and why

These were flagged as "decisions" when this pack was delivered. They are deliberate and tested, not defects.
If you disagree with one, change it through the named workflow, in one commit, with the tests.

## 1. Time is `nowMs: number`, not `now: Date`

Original rule: `VerdictInput.now: Date`. Now: `nowMs` (epoch milliseconds) and `windowEndsAtMs`.

**Why:** the replay feature recomputes a verdict from its stored input (`GET /api/verdict/replay`). The input is stored as JSON.
A `Date` does not survive a JSON round trip (it comes back as a string), so a `Date`-based input could not be replayed byte-for-byte.
An integer survives exactly. It also removes `new Date()` / timezone parsing from the pure file entirely, and makes the boundary test trivial
(`nowMs >= windowEndsAtMs`). The test "survives a JSON round trip of its input" in `lib/verdict.test.ts` is the guard.

**If you really want `Date` at the edges:** keep `nowMs` in `lib/verdict.ts` and convert at the boundary:
`nowMs: new Date(x).getTime()` in the route, `new Date(ms)` in the UI. Do not change the pure function's input type.

## 2. The verdict has world conditions and 3 extra reason codes

`CONDITION_MET`, `CONDITION_PENDING`, `CONDITION_UNMET` (and the `world: ConditionFact` input).

**Why:** without a condition in the world, Channel3 (a product price) and KERNEL (a page's text) have no job: PayPal alone can only tell you that
the payer approved an amount. The condition is what makes it a *standing* promise. Vendor data enters as a **frozen snapshot** and the verdict stays pure.
A promise with `condition: {kind:"none"}` behaves exactly like the original product (`AMOUNT_MET` / `AMOUNT_SHORT` / …).

**To remove it:** delete the three codes via `add-reason-code` in reverse, set `Condition = {kind:"none"}` only, drop `resolver`. You lose Channel3/KERNEL's role.

## 3. Payable currencies exclude INR

PayPal ended domestic payment services in India in 2021 and the Orders API rejects INR. `SUPPORTED_CURRENCIES` is the payable list;
INR stays parseable so an INR product reads fine and then yields `CURRENCY_MISMATCH` (WAIT). Demo in USD. (`check-invariants.mjs` fails if INR is added to the payable list.)

## 4. Astropods hosts an agent that calls us, not the other way round

The docs describe deployed agents as human-facing (web UI behind sign-in, Slack) and `frontend` agents as port-80 web apps; they do not describe a
programmatic invoke API. So the concierge calls our read-only endpoints and the app only links to it.

## 5. D-UI: Perplexity-Computer skin overrides (authorized 2026-11-08)

The UI overhaul task (`make Standing Promise look and behave like Perplexity Computer`) carries four owner-authorized
overrides. Everything else in `.devin/rules/*` still binds.

- **O1 — Permanent dark theme, no toggle.** Rule 20 lists "dark mode" under Deferred by default; the owner authorized a
  permanent dark theme for this overhaul (no toggle, no OS switch). Token values live in `app/globals.css` `@theme`.
- **O2 — Presentational files may exceed 60 changed lines.** Still one concern per file; the cap is waived for new UI
  files only, not for money-path or agent code.
- **O3 — A source file and its own `*.test.ts` count as one file** toward the "2 files per slice" cap.
- **O4 — CSS-only motion up to 200ms** (disclosure, drawer, pulse). No JS animation, no animation library.

## 6. D-BROWSE: Promise Browser overrides (authorized 2026-11-08)

The owner asked for an agentic browser (Comet-style, live in the UI) that pays through Standing Promises, CrawlerPal-style.
Three narrow overrides; everything else in `.devin/rules/*` still binds.

- **O5 — One extra browser origin, at runtime only.** The page may embed the KERNEL live view (`*.kernel.sh`, `*.onkernel.com`)
  in an iframe. The URL comes from the server and passes `safeLiveViewUrl` (https + host allowlist) before it reaches `src`;
  no source file names the host (the `no-external-origins` test stays untouched). Read-only by default, "Take over" is explicit.
- **O6 — The dev server may sit behind a free quick tunnel.** A cloud browser cannot reach `localhost`, so `PUBLIC_URL` points at
  the tunnel (trycloudflare). Sandbox money only. While the tunnel runs, `/api/promise` is publicly writable: stop the tunnel when not demoing.
- **O7 — Credentials never reach a model.** The PayPal sandbox buyer login is scripted server code (`PAYPAL_SANDBOX_BUYER_*` via
  `getEnv`), run on the live browser so it is visible, but the LLM only sees "approval done". Payment is always a Standing Promise
  (create -> approve -> settle); the verdict stays `computeVerdict`, and the agent can never call or influence it.

## 7. D-COMPUTER: one agent, not modes (authorized 2026-11-08)

The owner asked for a Perplexity-Computer surface: "I don't want ask mode as a standalone feature… all must be
connected." Consequences recorded so the structure is not re-litigated:

- **One chat, one endpoint.** `POST /api/agent` streams `CEvent`s for every request; `AgentProvider` lives in
  `AppShell` so the same conversation follows the user across `/`, `/p`, `/board`, `/timeline`. The earlier
  standalone `/ask` page, `components/ask/*` and `POST /api/research` were removed; their pure parts
  (`lib/research/*`, `AnswerText`, `SourcePane`) moved under `components/agent/`.
- **Screen context, not screen scraping.** The client sends `path`; on `/p?id=` the server adds the promise's
  stored facts (title, amount, state, condition, latest verdict, event kinds) as read-only `pageContext`.
  Selected text arrives as capped `attachments`. Nothing else on screen is captured.
- **Subagents are workers, not products.** research/browser/terminal run inside `runMain` on one shared KERNEL
  VM; they emit the same `CEvent` stream and report back to the main agent as messages. No subagent has its own
  route, page or session.
- **Free models only, enforced.** OpenRouter calls require the `:free` suffix (`isFreeModel`); Groq uses its
  free-tier chat models. Rotation + 429 cooldown live in `lib/computer/model.ts`.
- **The agent still cannot touch money.** It has no write tool; PayPal actions stay on the promise path
  (create/approve/settle via `/api/promise`). A future paywall beat (CrawlerPal-style 402) must route payment
  through a Standing Promise — never a direct capture.

## 8. D-PAYWALL: newsroom 402 + promise-agent payment (2026-11-08)

CrawlerPal beat: premium newsroom articles answer HTTP 402 with a `standing-promise` offer; a captured
Standing Promise unlocks them. Consequences:

- **Proof, not payment, is the condition.** `/api/newsroom/proof?article=<slug>` returns `locked:<slug>` or
  `unlocked:<slug> order=<STATUS>` — that public URL is the promise's `page_contains` needle, so the verdict
  path stays pure: PayPal order APPROVED + captured promise = unlock. No new reason codes, no protected edits.
- **The promise agent owns the money story.** `lib/computer/promise-agent.ts` matches the article (weighted
  slug/title/dek scoring, premium fallback for vague tasks), creates the promise via `/api/promise`, approves
  the sandbox order on the session's live VM (`paypal-approve.ts`, credentials never reach a model), settles,
  and returns the unlock URL. Main only delegates; the promise agent only ever calls the public ops.
- **Scripted approval is best-effort.** PayPal serves variants (en/pt_BR, honeypot password fields, two checkout
  UIs, cleared programmatic fills) that make full automation unreliable. The adapter uses visible-field selectors,
  real keystrokes and text-matched buttons, degrades honestly, and the agent then polls PayPal ~75s so a manual
  approval on the visible browser still completes the flow — that IS the demo beat.
- **Resolver budget raised for cloud browsers.** `kernel.observePage` spins a full cloud browser (~13-18s cold);
  the 14s resolver cap discarded completed snapshots as `unavailable` → FACT_MISSING → WAIT. Resolver is now
  20s inside a 30s cycle budget (`lib/agent/{registry,budget}.ts` — runtime layer, not the verdict).
- **`PUBLIC_URL` is required for the paywall proof.** `page_contains` URLs must pass `assertPublicHttpUrl`
  and KERNEL observes from the cloud, so the tunnel origin is used for proof/article URLs while `APP_URL`
  stays the app's own base.

## 9. D-LLM: four-provider free LLM layer (authorized 2026-11-09)

- **O8 — `lib/swarm/**` is a new top-level module** (5th-file rule satisfied once, here). Pure code plus the governor,
  `askJson` and `fanOut` toolkit. Its tests count with the file they test (as O3).
- **O9 — Size cap waived for test tables only.** Money-path and agent code keep the 60-line slice cap.
- Free models only on all four providers; allowlists are the enforcement. A paid or unknown model id is refused before any request.
- The LLM layer produces typed DATA. It never builds a Verdict and never reaches PayPal.
- **O18 — Owner-funded paid credits supersede "free-only" (authorized 2026-11-10).** TokenRouter
  (api.tokenrouter.com/v1), NVIDIA NIM (integrate.api.nvidia.com/v1) and Bluesminds (api.bluesminds.com/v1) join the
  provider layer behind `CAP_*` flags. The allowlist is still the only way a model id reaches the wire — the rule is now
  "allowlisted-only", not "free-only". Rotation is a full-roster round-robin with per-provider cooldowns
  (`lib/computer/model.ts`). Every new model id was confirmed in that gateway's live `/v1/models` before listing.

## 10. D-TREE: bounded recursive subagents (authorized 2026-11-09)

- **O10 — Tree shape is requested by models but ADMITTED by a pure function (`admitSpawn`)** inside `lib/swarm/tree/**`.
  Depth, fan-out, node count, privileges, budget and VM leases are code constants, not model choices.
- Children never get more capability than their parent (attenuation). No node at any depth reaches PayPal, the DB or a verdict.
- `lib/agent/**` keeps its fixed graph (rule 60). D-TREE does not apply there.

## 11. D-BUILDER: canvas editor for charters (authorized 2026-11-09)

- **O11 — The run view stays a list** (no tree canvas). Only the Chartering Office screen may show a node canvas.
- **O12 — Pointer drag is JavaScript;** motion stays CSS-only up to 200 ms (D-UI O4).
- **O13 — No new dependency or origin:** hand-built SVG plus pointer events.

## 12. D-CAMPUS: university naming layer — SUPERSEDED by D-PALS (2026-11-10)

The owner rejected the university theme. `lib/campus/**` was never built and must not be.

## 12b. D-PALS: the app is UltraPals (authorized 2026-11-10)

- **O19 — Display names only.** The app is **UltraPals**; the lead is UltraPal and the workers are ResearchPal, BrowserPal,
  TerminalPal, PromisePal (next to PayPal, on purpose). `lib/computer/pals.ts` is the single display map (`PAL_NAMES`, `palName`).
  Roles, ids, events, reason codes and receipts keep their canonical names; the delegate JSON still says `research|browser|terminal|promise`.
- "Standing Promise" stays as the name of the money mechanism (create -> approve -> settle), not of the app.
- New agents follow the same rule: a `<Thing>Pal` display name, a canonical role in data.

## 13. D-RIVAL: exchange programme (authorized 2026-11-09)

- **O15 — Exchange Fellows act only in competitor TEST environments** with test keys scoped outside the VM. Key prefixes are
  validated and any live key is refused.
- **O16 — Never enter a real card.** If a signup asks for one, the row is NOT_MEASURABLE (card required) and that rival is dropped.
- **O17 — Rival rows compare structure only** (never sandbox milliseconds, approval rates or fees) and carry a provenance label.

## 14. D-EXAM: RivalPal and the exam ladder (authorized 2026-11-10)

- **O20 — `lib/pals/**` is a new top-level module** (5th-file rule satisfied once, here). Pure code plus injected deps; tests count with
  the file they test (O3). It never imports a vendor adapter: search and models arrive through `GenDeps`.
- **Examiners, not deciders.** RivalPal researches how a deal fails (Tavily + Exa), spawns rivals, attacks the REAL `computeVerdict`
  with ten hostile worlds (`lib/pals/attacks.ts`) and reports a ladder. It changes nothing at runtime and never moves money. The seal
  (SEALED / CONDITIONAL / REFUSED) applies to a program before it ships, never to a runtime verdict.
- **Cite or die.** A rival survives only if every source is a page the fetcher fetched, every quote is a substring of that page, the
  timestamp and operator are the fetcher's (never the model's), `thesisOwner` appears in the evidence and the counter points at
  developer.paypal.com. Cited is not true: a substring check proves the quote exists, so every rival carries a confidence
  (independent domains, staleness) and one-domain rivals are `low`.
- **Fixed bars, honest blanks.** Pass lines live in `ARCHETYPE_TABLE`; the model never writes one. A missing measurement is
  NOT_MEASURABLE and never a pass. The judge always faces the full battery; other axes appear only where a cited rival owns them, and
  the rest print as excluded.
- **Known limit.** A text-only exam cannot observe most non-counterparty axes (identity, reversal need a real run), so those rows are
  NOT_MEASURABLE and a rival on a hard or unobservable axis REFUSES the deal. Measuring them from a real PromisePal run is the next step.
- Each model gets its own 40s deadline in `callModel` (`MODEL_TIMEOUT_MS`): a live run once spent 144s on stalled models.

## 15. D-SUPERPALS: rival examiners, seeded (authorized 2026-11-10)

- **O21 — The SuperPals are a FROZEN seeded roster** (`lib/pals/superpals.ts`): StripePal, ShopifyPal, ApplePal, AdyenPal,
  WisePal, KlarnaPal, X402Pal, SquarePal. Frozen so scores stay comparable across runs; the bars are analyst-set or measured,
  never model-written. This realises D-RIVAL (O15-O17) with Pal naming: their sandbox keys arrive later, act only in competitor
  TEST environments, never a real card, rows compare structure only.
- **A SuperPal row is the competitive delta on the receipt; it NEVER gates the seal.** A missed delta is information for the
  next build, not a refusal. Only the exam's own rows (lib/pals/ladder.ts ARCHETYPE_TABLE) feed decideSeal.
- **A missing sandbox key is NOT_MEASURABLE with the env key named** (`STRIPE_SANDBOX_KEY not provided yet`) — never a pass,
  never an invented score. X402Pal needs no key: its bar (no human at capture) is measured from the real run log.
- **The run log (`lib/pals/measure.ts`).** PromisePal records what really happened (approved, settled, state, order read-back
  after settle, money ops carried the promise id) and RivalPal measures the exam against it: consent is not capture
  (human_steps_at_capture = 0), a release is only verified when the read-back shows no money moved, and identity is measured
  from the mandate ref on every money op. Until a run exists those rows stay NOT_MEASURABLE.

## 16. D-CHAIN: SuperPals spawn their own workers (authorized 2026-11-10)

- **O22 — D-TREE is realised in `lib/swarm/tree/**` (pure: `types`, `policy`, `budget`, `merge`).** `admitSpawn` is the only place a spawn
  is allowed or refused (reason, privilege, dedupe, repeat, depth, fan-out, nodes, loop caps, budget share, deadline). `attenuate` makes
  a child's tools, spawn kinds and budget an intersection of its parent's. The tool enum has no PayPal, database or money member.
- **The chain is main -> RivalPal -> SuperPal -> ResearchPal.** Each SuperPal sends one script-mode ResearchPal (one Tavily or Exa
  search, 0 model calls). It returns a verbatim cited line (`lib/pals/evidence.ts`). Evidence is context: it never changes a row's
  status and never gates the seal (D-SUPERPALS still binds). Sandbox keys, when they arrive, are a separate Fellow, not this worker.
- **UI follows 9b of the swarm spec:** one status line, one collapsed Process row labelled from counts (`processLabel`), children
  indented at most 2 levels under their parent (`disclosureRows`), declined spawns shown as muted rows, one read-only node panel.
- **Speed:** `callModelHedged` races `hedge` models (default 2) and aborts the loser; an aborted loser is never put on cooldown.
  `generateRivals` starts the default searches while the model plans and caches (queries, pages) per deal for 10 minutes.
- Not built from the long spec, on purpose: charter canvas (D-BUILDER), Case Desk, Proctor, Presenter, live rival sandboxes.
- **O23 — Exam scorecard chart (`lib/pals/chart.ts`, `components/agent/ExamChart.tsx`).** A chart spec holds a kind, a reason and row ids
  only; every plotted number is looked up from the sealed card, so no value can be invented. A row that was not measured is drawn as a
  dashed break, never a zero. Same rows give the same geometry. A model-chosen spec is not wired yet; the default spec is deterministic.

## 17. D-SITUATION: SituationPal compares rails for an idea (authorized 2026-11-10)

- **O24 — SituationPal** takes an idea, picks its payment needs from a CLOSED list (`lib/pals/situation.ts` NEEDS; the model cannot invent
  one), gives every rail (PayPal + 8 rivals) its own Pal, and researches with Tavily and Exa in rounds (max 3, max 27 searches) until each
  (rail, need) pair has a cited answer or a budget ends. The card records why it stopped and how many pairs are still unknown.
- **Cite or die per cell.** A classified cell survives only if its url was fetched for that rail, its quote is a verbatim substring of the page,
  the page names the rail, and the need was one of the idea's. Time and operator are the fetcher's. Unknown is a band (fit..upper), never a zero.
- **Real sandbox checks, structure only (O15-O17).** `lib/integrations/rails.ts`: Stripe TEST mode (`sk_test_` only, capability off for any other
  prefix) and the Square SANDBOX (host hard-coded) each run: bad request -> typed error, charge with the documented test token, same-key
  replay, refund, refund read-back. PayPal is READ-ONLY (a GET of a missing order for its typed error, plus the last real promise run); what
  needs a PayPal write says why it was not measured. The agent still holds no PayPal write tool.
- **Not used:** the Coinbase CDP key pasted by the owner. CDP has no sandbox, so it stays out of `.env.local`; X402Pal is still measured from the run log.
- **The future is an inference.** Fit is today's published support weighted by the idea. Nothing in the card is a forecast and the summary says so.

## 18. D-DESK: SituationPal runs as a Case Desk; no separate Case Desk agent (authorized 2026-11-10)

- **O25 — The Case Desk pipeline lives inside SituationPal** (`lib/pals/recommend.ts`, `lib/computer/situation-agent.ts`): intake from a closed
  list -> typed evidence -> pure rubric `judgeRecommendation` (APPROVE / HOLD / FLAG, closed reason codes, no REJECT) -> blind check -> hashed receipt
  a person confirms. Missing or conflicting evidence is HOLD; a failed sandbox defect check or a blind pick outside the contenders is FLAG.
- **Open-ended rails.** A ScoutPal's models propose rails beyond the nine seeds (Lemon Squeezy, Razorpay ...). A rail enters the comparison only if a
  fetched page names it and the quote is verbatim (`verifyRails`); the comparison is capped at 14.
- **"Until the best is met" is an algorithm, not a vibe.** After each round, rails whose best case (upper bound) cannot reach the leader's cited fit
  are eliminated and no longer searched. Research stops when one rail's cited fit beats every other's best case and the leader's weight is
  >= 75% cited (`best_found`), or on `complete`, `max_rounds` (4), `search_budget` (40), `no_progress`. The card says which.
- **Blind check.** The blind reader's family (the second family in the roster) is fixed up front and every other call is kept off it, so it can never
  be the family that classified the evidence. It sees the typed grid only: no idea text, no rubric, no reasoning. One family reachable = HOLD.
- **The human marker is local.** "I confirm" is stored in the browser's localStorage under the receipt id; it is not a server record.

## 19. D-PROCTOR: scheduled checks that open a case only on a confirmed change (authorized 2026-11-10)

- **O26 — `lib/proctor/**`** (pure `core.ts`, in-memory `store.ts`, `run.ts`) and `POST/GET /api/proctor`. One job today, `sandbox_canary` (the same Stripe-test,
  Square-sandbox and PayPal-read-only checks SituationPal runs). Diff-first: an equal structural fingerprint stops with no further work; a change is
  re-checked at once; only a CONFIRMED change opens a case, subject to a daily case budget and quiet hours. A check that cannot run is `missed`, never "no change".
- **Zero model calls.** `POST` requires `x-proctor-token` when `PROCTOR_TOKEN` is set and is rate-limited. Set the token before exposing the app.
- **Known limit:** state is per server process (a restart makes a new baseline, never a false alarm). Durable state needs a schema change to a protected file.
