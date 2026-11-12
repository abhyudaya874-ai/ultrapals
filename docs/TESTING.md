# Testing

**2,523 tests in 143 files, plus 10 mechanical invariant checks and a production build, all behind one command.** This page says what that covers, how we checked the parts tests cannot reach, and what is not tested.

```bash
npm run verify:fast   # invariants + typecheck + tests (about 10 s). After every edit.
npm run verify        # + next build. Writes .devin/.last-verify; a hook blocks `git commit` without a fresh one.
node scripts/check-invariants.mjs      # just the mechanical rules
npx vitest run lib/verdict.test.ts     # one file
node --test astropods/agent.test.mjs   # the hosted concierge agent (4 tests)
npm run test:api                       # the Postman collection through newman, against a running app
```

## The gate (`scripts/verify.mjs`)

| Stage | What it proves |
|---|---|
| Invariants (10 checks) | `lib/verdict.ts` imports nothing and reads no clock; its `@deterministic` marker is intact; reason codes are in sync between the table, `REASON_CODES` and the test; no floats on the money path; INR is not payable (PayPal does not process it); **nothing under `lib/agent/**` or `lib/computer/**` mentions `computeVerdict`**; every integration goes through `guard()` and `getEnv()`; a live PayPal key or `api.paypal.com` fails; no `any` and no lint suppressions; protected files keep their invariant markers |
| `tsc --noEmit` | strict TypeScript across the app, including the vendors' own `.d.ts` files (Kernel, MCP, Render, AG Studio, Bryntum) |
| `vitest run` | the unit tests below |
| `next build` | every route compiles (`verify` only) |

A failing invariant names the line. The script says "do NOT edit this script to make it pass", and we did not.

## What the 2,523 tests cover

| Area | Files | Tests | What is pinned down |
|---|---|---|---|
| `lib/computer` | 25 | 356 | the agent loop's event reducer, model rotation and cool-downs, hedged races, the live token events, per-agent reports, delegation and its limits |
| `lib/arena` | 15 | 435 | plan validation, personas, blind judge scrubbing, bracket and byes, the duel arithmetic, loop stopping and round diffs, and the home-screen mode preview (real bracket and duel with stand-in scores, the bracket as a tree, every beat of both tapes, captions short enough to read) |
| `lib/automations` | 8 | 253 | the eight kinds, per-kind ceilings, schedules, the "time word" gate, the page-watch parser |
| `components/agent` | 13 | 205 | markdown and citations, the paced display queue, panel and tab model, image prep, suggestions |
| `lib/pals` | 14 | 176 | cite-or-die verifiers, the ladder and the seal, SuperPal bars, Case Desk grids, `NOT_MEASURABLE` |
| `lib/browse` | 4 | 135 | page snapshots, the SSRF guard, reading pages safely |
| `lib/charts` | 3 | 116 | 22 chart types picked and fitted from table shape |
| `components/shell`, `thread`, `orbs`, `arena`, `charts`, `ui`, `studio` | 17 | 376 | sidebar and palette logic, auto-scroll (`stick.ts`), effort themes, hover-card placement, the AG Studio chat adapter, the mode preview geometry (orb layout for 2 to 6, fighter poses, the knockout tree and which of its lines are lit, the Loop ring and baton) |
| `lib/integrations` | 11 | 84 | Channel3, Zapier, Bryntum, KERNEL and PayPal parsers against recorded shapes; the spending guard wired into both places that create a cloud browser (with the SDK replaced) |
| `lib/usage` | 4 | 76 | token estimates, context windows, the collective ring, the wording on the card |
| `lib/budget` | 2 | 17 | the spending ledger (concurrent and per-day caps, a failed start still counts, stale records forgotten) and the daily gate (a person's share, then the whole server's) |
| `lib/verdict.test.ts`, `lib/money.test.ts` | 2 | 60 | the whole decision table, integer money |
| `reference/` | 11 | 126 | the starter pack's own copies of the verdict, money, adapters and agents |
| everything else | 14 | 108 | research, swarm policy, proctor, SSE, environment parsing, route helpers |

(`reference/` is the original build pack's code and tests. We keep it green but the live app is everything above it.)

## Tests that are known to fail when the code is wrong

A test that cannot fail is decoration. For the two behaviours behind the "stuck context ring", we broke the code on purpose and checked the suite noticed:

* Remove the line that stops the first-word timer once a model starts talking: the test "does not hurry a model that is thinking" fails.
* Remove the spending guard from `openBrowser` or from `observePage`: `kernel-budget.test.ts` fails (two tests for the first, one for the second).
* Move the opening token report back to after the model has been asked: "reports the prompt before the model has even been asked" and "announces each model as it is tried" fail.

## What we checked by running it (not part of CI)

Some failures only show in a real browser against real free-tier providers. We drove headless Chromium over the DevTools protocol and compared what the page showed with what the server sent:

* **Context ring vs event stream.** In a chat that sent out three Pals, the ring's token total equalled the sum of each agent's latest call from the wire at every 300 ms sample (longest mismatch 0.0 s). Before the fixes it fell silent for up to 75 s while a model was slow to answer and its window swung between 131K and 1.4M as the model rotation changed.
* **The popover while text streams.** Opening the card during a run and logging every scroll, focus and pointer event showed the old code closing it on the thread's auto-scroll. After the fix it stayed open for the whole run in three separate runs.
* **Battle and Loop rings.** A 2-team Battle showed one ring per team plus a ring for the judge and writer; a 2-round Loop showed one per round.
* **No console errors** in any of those runs.

Bugs that running found (tests had not), each now with a regression test: a paced display queue that froze after the first burst of events; a context ring that went silent during slow model starts; a hover card that closed on every auto-scroll; a scheduling gate that fired on "a few cents each"; a planner that used every round without answering and was recorded as a finished run.

## What is not tested

* **Live vendor calls.** Anything that needs a key (Groq, NVIDIA, Bluesminds, OpenRouter, Tavily, Exa, KERNEL, Channel3, Elastic, Zapier) is tested against the shapes the vendor's docs and types give us, not against the vendor, so CI never spends a free-tier quota. Elastic, Zapier and Astropods are built and tested but were not exercised against live accounts.
* **Provider quality and uptime.** Free tiers rate-limit and fail. The suite checks that we rotate, cool down, race and drop silent models, not that any given provider answers well.
* **Production money.** Sandbox only. It proves the mechanism and the state machine, not fraud reduction or conversion.
* **Scrolling back up while text streams** (resume following at the end) is covered by the pure helpers' tests but was not driven in a live browser.
* **Accessibility and mobile** were not audited.
