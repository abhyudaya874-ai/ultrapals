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

## 12. D-CAMPUS: university naming layer (authorized 2026-11-09)

- **O14 — `lib/campus/**` is a pure display map.** No behaviour change; canonical codes stay in data, events and receipts.

## 13. D-RIVAL: exchange programme (authorized 2026-11-09)

- **O15 — Exchange Fellows act only in competitor TEST environments** with test keys scoped outside the VM. Key prefixes are
  validated and any live key is refused.
- **O16 — Never enter a real card.** If a signup asks for one, the row is NOT_MEASURABLE (card required) and that rival is dropped.
- **O17 — Rival rows compare structure only** (never sandbox milliseconds, approval rates or fees) and carry a provenance label.
