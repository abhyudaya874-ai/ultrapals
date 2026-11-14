# Integrations: what each sponsor does for Standing Promise

One contract for all of them: `AdapterResult`, always through `guard()`, behind a `CAP_*` flag, never inside the verdict.
**Vendors produce snapshots, never verdicts.** (`rules/80-integrations.md`)

| Sponsor | Slot in the product | Method used | Off / degraded | Flag | Demo beat | Prize angle |
|---|---|---|---|---|---|---|
| **AG Studio** (AG Grid) | `/board` dashboard; 2 custom widgets; agent | `AgStudio` + `createWidgets` custom widgets with `dataMapping`; `createAiHarness` + `directLlmRunner` with our own tested `chatAdapter`; `api.defineAiTool` | trace page | `CAP_STUDIO` | "ask the analyst why this was released" | Best Use of AG Grid: custom widgets + theming + Agent Framework (a custom agent next to the built-in lead) |
| **Channel3** | resolves `price_at_most` conditions | `POST /v1/search` (`x-api-key`) → cheapest in-stock offer → `ProductFact` | manual price entry → else WAIT | `CAP_CHANNEL3` | create "Nike Pegasus under 120" | must be a meaningful API call: it is the evidence for a captured payment |
| **KERNEL** | browser read + replay evidence; **Computer agent's cloud VM** (live Chromium + shell, one VM per session) | `@onkernel/sdk`: `browsers.create` → `replays.start` → `playwright.execute` → `replays.stop` → `deleteByID`; live view: `browser_live_view_url` iframe (O5), `browsers.computer` mouse/keyboard, process API for the terminal | plain `fetch` (SSRF-guarded) | `CAP_KERNEL` | open the replay link: "the actual page"; watch the agent's cursor drive the live browser | live agent infra with replay |
| **Elastic** | precedent + analytics | Jina embeddings via EIS (`semantic_text`), hybrid RRF retriever, ES\|QL `/_query`, Agent Builder tool | no precedent clause | `CAP_ELASTIC` | "2 of 3 similar promises ended UNMET" | multi-step agent using Elasticsearch + Jina |
| **Bryntum** | `/timeline` | `BryntumScheduler` resources=payers, events=promises; drag → `reschedule` | event log table | `CAP_BRYNTUM` | drag a bar, due date moves | "subscription revenue radar" style scheduler with failed/refund markers |
| **Astropods** | hosted **Promise concierge** agent (web UI on port 80) that calls our read-only endpoints; model from the AI Gateway | `astropods.yml` (`spec: blueprint/v1`), `ast blueprint push/deploy`; agent → `/api/verdict/replay`, `/api/studio/query` | no link on the home page | `CAP_ASTROPODS` | "ask the concierge why this was released"; Astropods dashboard screenshot | agent OS: a deployed, monitored agent |
| **Render** | hosting + durable sweep | `render.yaml` web service; Workflows `task()` + `startTask`; tasks call our single write endpoint | settle in-request | `CAP_RENDER` | close the tab, sweep still finishes | coordinates background agents/jobs |
| **Zapier** | friendly nudges | Zapier MCP (Streamable HTTP) via `@modelcontextprotocol/sdk`; tool arguments built from the tool's own input schema (`instructions` always) | in-app banner | `CAP_ZAPIER` | email arrives: "hey, just a heads-up!" | the "nudge-bot" idea from the AG Grid brief |
| **APIMatic** | build-time | `npx context-plugins install paypal`; verify `lib/paypal.ts` against it | n/a | n/a | the `docs/APIMATIC-LOG.md` trail | free months for using the plugin |
| **Postman** | build-time + CI | collection with tests, mock server, monitor, `newman` | n/a | n/a | green monitor screenshot | API quality |

## The Computer agent's own stack (not sponsors — free tiers, all degradable)

| Provider | Slot | Method | Off / degraded | Flag |
|---|---|---|---|---|
| **Tavily** | web search, run in parallel with Exa | `POST api.tavily.com/search` (`api_key` body) | that provider's results missing, answer still cites what arrived | `CAP_TAVILY` |
| **Exa** | web search, run in parallel with Tavily | `POST api.exa.ai/search` (`x-api-key`, `contents.highlights`) | same | `CAP_EXA` |
| **Groq** | primary free LLM (chat + agent action loops) | OpenAI-compatible `POST api.groq.com/openai/v1/chat/completions`, streamed | rotation falls through to OpenRouter | `CAP_GROQ` |
| **OpenRouter** | fallback free LLM — `:free` suffix enforced in code, a paid model can never be requested | same shape, `openrouter.ai/api/v1` | agent reports the error inline | `CAP_OPENROUTER` |
| **Google AI Studio** | free-tier Gemini models in the rotation (3.5 Flash-Lite leads a turn; 3 Flash races in Ultra and reads pictures first) — only ids marked "Free of charge" are allowlisted | OpenAI compatibility, `generativelanguage.googleapis.com/v1beta/openai`, Bearer key, streamed with counted tokens and a summarised think | rotation falls through to Groq, NVIDIA, OpenRouter | `CAP_GEMINI` |

Free-plan limits are real (Groq ≈30 RPM / 8K TPM per model; Gemini 15 a minute per Flash-Lite model and 20 a day for 3 Flash, from its own 429s): `lib/computer/model.ts` rotates models and cools a
model down after 429; `lib/research/rate-limit.ts` caps requests per client. Keys live only in `.env.local`.

## Why the verdict never imports an adapter

A judge can re-run a promise and must get the same answer. If the verdict read Channel3 live, a price move between runs would
flip it. The resolver freezes what it saw in `condition_snapshot`; the verdict event stores `{verdict, input}`; the replay route
recomputes from that input with the same pure function.

## Honest status (what was and was not verified)

| Verified in this pack | Not verified (needs a live key) |
|---|---|
| All code typechecks against the REAL SDK `.d.ts` (Kernel, MCP, Render, AG Studio incl. the LLM adapter, Bryntum) | any call to a live vendor |
| 126 unit tests: Channel3/Zapier/Bryntum/SSRF parsers, the Studio chat adapter (request + stream mapping, fake fetch), money, verdict table | a live Studio session driving the adapter |
| Astropods concierge: 4 tests + in-process HTTP smoke test; spec, Deploy and AI Gateway pages read | the gateway's tool-calling on a real Astropods account |
| `next build` compiles all routes incl. Studio + Bryntum | Zapier behaviour on YOUR action (adapter adapts to its schema, and degrades with the real tool list if the name is wrong) |
| `drizzle-kit generate` produces the migration (included) | Render workflow start details (public beta) |
| Endpoint/header facts re-read from docs (Channel3 `x-api-key`, Zapier MCP handshake, Render Blueprint ≠ Workflows, PayPal does not process INR) | PayPal sandbox flow end to end |

## Order to wire them (each already has a degraded path, so none blocks the money path)

Day 1–2 money path green with all `CAP_*=0`. Day 3 Channel3 + KERNEL (`wire-world-condition`). Day 4 Studio board + Bryntum + Zapier.
Day 5 Render deploy + sweep, Postman, APIMatic log. Elastic and Astropods last, only once the money path is green twice.

## SuperPal sandbox keys (D-SUPERPALS; keys arrive later, blank = row reports "not provided yet")

| Pal | How to get the key (verified 2026-11-10) | Env key |
|---|---|---|
| StripePal | dashboard.stripe.com/register -> API keys; sandbox `sk_test_` keys are instant and free; agent-tagged restricted keys carry approval rules | `STRIPE_SANDBOX_KEY` |
| SquarePal | developer.squareup.com sign-up -> Developer Console -> Credentials -> Sandbox access token; host `connect.squareupsandbox.com` | `SQUARE_SANDBOX_KEY` |
| X402Pal | cdp.coinbase.com -> API keys; x402 buyer/seller quickstarts + Agentic Accounts; Base testnet faucet funds it | `COINBASE_SANDBOX_KEY` |
| KlarnaPal | docs.klarna.com -> Log in -> region -> Playground -> Sign up; key format `klarna_test_api_...` | `KLARNA_SANDBOX_KEY` |
| AdyenPal | test Customer Area -> Developers > API credentials -> Generate API key (`ws_...@Company...`, shown once) | `ADYEN_SANDBOX_KEY` |
| WisePal | free sandbox account (no verification, 1M GBP test credit); personal token from the account page (2FA); host `api.wise-sandbox.com` | `WISE_SANDBOX_KEY` |
| ShopifyPal | Dev Dashboard app -> Client ID + Client secret -> client-credentials token (24h, refresh programmatically); needs a dev store in the same org | `SHOPIFY_SANDBOX_KEY` (store `id:secret`) |
| ApplePal | NO standalone sandbox: Apple Developer Program ($99/yr) + merchant ID + payment-processing certificate + verified domain, or a PSP. Practical route: PayPal Expanded Checkout supports Apple Pay | `APPLE_SANDBOX_KEY` |

Order: Stripe/Square/Coinbase/Klarna instant -> Adyen -> Wise -> Shopify -> Apple (skip or via PayPal).
Rules that still bind: O15 (competitor TEST environments only, keys scoped outside the VM), O16 (never a real card), O17 (structure-only rows).
