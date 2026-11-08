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
