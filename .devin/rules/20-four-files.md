---
trigger: always_on
description: Scope discipline: four protected files, a pre-approved support list, and worked scope-gate examples
---

# Four files, two domains

The demo slice is the **four protected files**. Everything else is either pre-approved support or needs a stated reason.

## Pre-approved support files (no justification needed)

`lib/money.ts` `lib/env.ts` `lib/events.ts` `lib/paypal.ts` `lib/capture.ts` `lib/sse.ts` `lib/llm.ts`
`lib/agent/**` `lib/integrations/**` `lib/studio/**` `db/index.ts` `components/**` `app/page.tsx` `app/layout.tsx` `app/board` `app/timeline`
`app/api/{studio,verdict,promises,render,capabilities}/**` `workflows/**` `astropods/**` `postman/**` `drizzle/**` and test files next to what they test.

Anything not on this list (a new route, a new table, a new dependency, a new top-level folder) needs
**one line in the commit body**: `5th file: <path> because <reason>`.

## The two domains

1. `localhost:3000` (the app; the Render URL once deployed)
2. The PayPal sandbox origin (approval page + the server-side capture leg)

No CDN, analytics, auth provider, object storage, or third-party fonts in the browser.
Server-side calls (PayPal, Channel3, KERNEL, Zapier, Elastic, the optional LLM) are fine: they are reached *through* the app.
The one browser-visible exception: a KERNEL replay link opened in a NEW TAB as evidence.

## Scope gate: answer these before writing code

1. Which protected files does this touch? (list them)
2. Does it add a dependency? Can installed packages do it?
3. Does it add a browser-visible domain? If yes, it waits.
4. Does it fit in ≤ 2 files and ≤ 60 changed lines? If not, `/orchestrate`.

## Worked examples

**"Add a dark mode toggle."**
Gate: touches `app/layout.tsx`, `globals.css`; no protected file; no dependency; but it is in the Deferred list.
Decision: DEFER. Append to `docs/BACKLOG.md`: `dark mode toggle — not on a demo beat`. Do not build it.

**"Show the amount in the page header."**
Gate: `app/p/page.tsx` (protected, invariant: renders without network) + `components/PromiseSurface.tsx`.
The amount is already passed as `amountLabel`. Decision: 1 protected + 1 support file, 5 lines. Proceed, state the invariant.

**"Email the payer when the promise is captured."**
Gate: new dependency (mail SDK), new domain, webhooks. Decision: DEFER. It is not a demo beat.

**"Add a `refunded` state."**
Gate: `db/schema.ts` (`PROMISE_STATES`), `lib/capture.ts`, `route.ts`, UI tone map, a migration.
That is 3 protected files plus a schema change. Decision: `/orchestrate`, split into (a) schema+migration, (b) logic, (c) UI.
Also ask: is there a demo beat for it? No → backlog.

## Deferred by default

Auth, multi-tenant, email, webhooks beyond capture, admin UI, i18n, dark mode, animation beyond the trace panel.
Write them to `docs/BACKLOG.md` and move on.
Dark mode exception: the permanent dark theme is authorized by `docs/DECISIONS.md` §5 (D-UI).
Live browser exception: one runtime iframe origin (KERNEL live view) is authorized by `docs/DECISIONS.md` §6 (D-BROWSE, O5).

## When scope must grow, say the cost out loud first

`Adding X costs one dependency and one domain; skipping it costs the demo beat at 1:40.` Then decide. Do not drift into it.
