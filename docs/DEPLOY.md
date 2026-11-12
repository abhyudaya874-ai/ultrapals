# Deploying on Render (and what it costs)

UltraPals runs as **one Render web service**: the UI, the API routes, the long agent streams and the in-process automations timer. Live demo: <https://ultrapals.onrender.com>.

## Why a server and not a serverless host

We would have loved a free serverless tier, and we tried to think it through before ruling it out. The app is not shaped for it:

| What the app needs | Why a serverless function cannot give it |
|---|---|
| A Battle streams for minutes (`/api/agent` sets `maxDuration = 600`) | functions have per-request time limits, and a plan's limit may be shorter than a Battle |
| One conversation holds one cloud computer; sessions, sources and rate limits live in process memory | consecutive requests can land on different instances, so a follow-up would say "session expired" |
| Automations are saved to `.data/automations.json` and checked by an in-process timer | no durable disk, no long-lived timer |

The money pages and API would work on a serverless host (they are request/response against Postgres). The workspace, which is the product, would not. A free Render instance has the right shape but **spins down after 15 minutes idle** (a judge's first click would wait about 30 seconds) and cannot have a disk. So the live demo uses the cheapest always-on instance.

## What is running

| | |
|---|---|
| Service | `ultrapals`, a Render **web service**, Node 22, `npm ci && npm run build`, `npm run start` |
| Instance | **Starter** (0.5 CPU, 512 MB), one instance, no autoscaling |
| Region | Singapore, next to the Neon database (`ap-southeast-1`) |
| Disk | 1 GB at `/opt/render/project/src/.data`, so saved automations survive a redeploy |
| Health check | `/api/capabilities` |
| Deploys | from `main` of [the repo](https://github.com/abhyudaya874-ai/ultrapals). A service created from a public repo URL gets **no push webhook**, so a push does not deploy by itself: trigger one with `POST /v1/services/<id>/deploys` or the dashboard's *Manual Deploy*, or connect the GitHub app in the dashboard to get auto-deploy |
| Its own address | `RENDER_EXTERNAL_URL`, which `lib/env.ts` uses as `APP_URL` when none is set, so PayPal's return URL and the app's calls to itself are right with no second pass |

**Measured, not guessed:** a full 2-team Battle (two cloud computers, a judge and a writer) on this instance size peaked at **178 MB of the 512 MB**, with no restart. The API call is `GET /v1/metrics/memory?resource=<service id>`.

## What it costs, and why nothing should reach your own wallet

The hackathon gave $50 of Render credits. Render bills compute **per second** (a service that is on for ten seconds in a month is billed for ten seconds), at the instance's monthly rate. The $7 figure is from Render's published pricing; the dashboard's billing page shows the live balance, and the disk's price is on the disk page.

| Item | Rate | Cost of leaving it on |
|---|---|---|
| Starter instance | $7 per month | about **$7 a month** |
| 1 GB disk | billed per GB per month (see the disk page in the dashboard) | small |
| Workspace | Hobby, $0 | $0 |
| Bandwidth | 5 GB included, then $0.15 per GB | about $0: the agent streams text, and the cloud browser's live view is served by KERNEL, not by this server |
| Builds | included minutes per month; each build is about 3 minutes | about $0 |

At about $7 a month for compute plus the disk, **the $50 covers well over a month at any rate we could be charged, and roughly six months for compute alone**. To stop the meter earlier, suspend the service (`POST /v1/services/<id>/suspend`) or delete it.

### Everything else that could spend money is capped in code

A public link lets strangers start things. These caps live in the server, are tested, and apply to everyone together unless stated:

| What | Cap | Where |
|---|---|---|
| Cloud computers (KERNEL bills a browser while it is alive) alive at once | **6** (`KERNEL_MAX_BROWSERS`) | `lib/budget/ledger.ts`, used by both places that create a browser |
| Cloud computers started in any 24 hours | **150** (`KERNEL_MAX_PER_DAY`) | same ledger. A start that fails still counts, because it may have created something |
| Chat messages in any 24 hours | **250** (`DAILY_RUN_CAP`), and a quarter of that per address | `lib/budget/daily.ts`, in `/api/agent` |
| Battles and Loops in any 24 hours | **30** (`DAILY_CONTEST_CAP`), and a quarter per address | same |
| Per address, per minute | 6 messages, 2 contests, 4 new browsers per 5 minutes | the routes |
| Automations | 8 in total, 2 heavy ones at once, per-kind daily caps | `lib/automations` |

Providers, and why each is $0 here:

| Provider | Why it cannot bill you |
|---|---|
| Groq, NVIDIA NIM | free tiers; requests fail when a limit is hit |
| OpenRouter | `:free` models only, enforced in `lib/integrations/chat.ts` (a paid model id is refused before any request) |
| Tavily, Exa | free allowances; a missing balance returns an error |
| **Bluesminds** | a credit-funded gateway, so it is **switched off on Render** (`CAP_BLUESMINDS=0`) and its key was not given to Render |
| TokenRouter | off, and its key was not given to Render |
| Anthropic, AG Studio's LLM proxy | not configured on Render, so no code path calls them (`lib/llm.ts` and `/api/studio/llm` both do nothing without a key) |
| PayPal, Stripe, Square | sandbox and test mode only; a live key is refused by an invariant check |
| Neon | the free Postgres you already had |

Two things we could not check from here and you should: the **KERNEL** and **Exa** accounts' billing pages. If either has a card on file with pay-as-you-go, the caps above are what stands between a public link and your card, so tighten `KERNEL_MAX_BROWSERS` / `KERNEL_MAX_PER_DAY` in the Render dashboard if you want less headroom.

## Setting it up yourself

**With the Blueprint** (`render.yaml` in the repo): in the Render dashboard choose *New, Blueprint*, pick the repo, and fill the variables marked `sync: false`. Then add a card (Render will not create a paid instance without one).

**With the API**, which is what we did: `POST https://api.render.com/v1/services` with `type: web_service`, the repo, `serviceDetails.plan: starter`, a `disk`, and the environment variables. A paid plan returns `402` until a card is on file, and a service cannot be changed between free and paid afterwards (it has to be recreated).

Environment variables (names only; see `env.example`):

| Needed | Variables |
|---|---|
| The money path | `DATABASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox` |
| Scripted sandbox approval | `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD` (used on the cloud computer, never sent to a model) |
| The cloud computer | `CAP_KERNEL=1`, `KERNEL_API_KEY` |
| Models and search | `CAP_GROQ`, `GROQ_API_KEY`, `CAP_NVIDIA`, `NVIDIA_API_KEY`, `CAP_OPENROUTER`, `OPENROUTER_API_KEY`, `CAP_TAVILY`, `TAVILY_API_KEY`, `CAP_EXA`, `EXA_API_KEY` |
| Spending limits (defaults shown) | `KERNEL_MAX_BROWSERS=6`, `KERNEL_MAX_PER_DAY=150`, `DAILY_RUN_CAP=250`, `DAILY_CONTEST_CAP=30` |
| Build | `NODE_VERSION=22`, and the `NEXT_PUBLIC_*` variables for AG Studio (they are read at build time) |
| Not set on purpose | `APP_URL` (the service uses `RENDER_EXTERNAL_URL`), `ANTHROPIC_API_KEY`, `STUDIO_LLM_*`, `BLUESMINDS_API_KEY`, `TOKENROUTER_API_KEY` |

## Stopping it

```bash
# pause the compute meter (check the billing page for what a suspended service's disk still costs)
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/<service id>/suspend
# or remove it
curl -X DELETE -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/<service id>
```

## Render Workflows

The repo contains a Render Workflows sweep (`workflows/`, `lib/integrations/render.ts`), built and tested but **switched off** (`CAP_RENDER=0`) in the live demo. Blueprints cannot define Workflows; they are created in the dashboard. Settling happens in the request, as before.
