# Automations

Pals that work while you sleep, inside ceilings that cannot be argued with. An automation runs the same team you chat with, with nobody watching, on a schedule.

> Anything that runs unattended is a spending and safety risk, so every kind has its **own** shortest interval, daily cap and time limit, and the two most expensive kinds are limited to two switched on at once.

## Eight kinds

| Kind | Who goes first | What it does | Shortest repeat | Runs / 24 h | Time limit |
|---|---|---|---|---|---|
| **Team task** | UltraPal + whole team | research, browsing, terminal work, files | 30 min | 12 | 8 min |
| **Research brief** | ResearchPal | searches the web, writes a short cited brief | 30 min | 12 | 8 min |
| **Browser task** | BrowserPal | opens a page and does something there | 30 min | 12 | 8 min |
| **Page watch** | BrowserPal | re-reads a page and says what changed since the last run | 30 min | 12 | 8 min |
| **Rail check** | SituationPal | compares PayPal with other rails for your idea, with sandbox checks | 60 min | 6 | 10 min |
| **Deal exam** | RivalPal | stress-tests a deal; reports SEALED, CONDITIONAL or REFUSED | 60 min | 6 | 8 min |
| **Battle** | 2 to 4 teams | teams with different methods answer one question; a blind judge picks | 6 h | 3 | 15 min |
| **Loop** | 2 to 4 rounds | rounds on different scenarios, each aimed at the weakest point so far | 6 h | 3 | 15 min |

Schedules: every N minutes (30 minimum, one week maximum), or daily, weekdays or weekends at a local time. After downtime a run happens **once**, not once per missed interval.

## Global ceilings

* At most **8** automations in total.
* At most **2** heavy automations (Battle, Loop) switched on at once. Each run opens a cloud computer per team, so the store refuses a third and says why.
* One run at a time per server process.
* **No money.** `promise` is denied inside every automation, and so is `automate`, so an automation can neither move sandbox money nor create another automation.
* UltraPal's `automate` action only works when **the user's own message contains a scheduling word** (`asksForSchedule`). A web page cannot talk it into creating a job. A test found that "a few cents each" and "use each one's fee page" had counted as asking for a schedule, so the gate now requires a *time* word.

## Page watch: the answer is parsed by code

A watch hands the browser the page and compares with the last finished run. Its answer must start with `BASELINE`, `CHANGED` or `UNCHANGED`, and **code reads that word** (`parseWatch`) rather than trusting a model's tone.

A run nobody could help through a CAPTCHA records the wall (`blocked`), and the page offers **Run with me watching**, which runs the same job as a normal chat run where the browser can stop and ask.

## Persistence and scheduler

| Piece | Behaviour |
|---|---|
| Store | `.data/automations.json`, git-ignored, re-read on every operation and replaced atomically |
| Scheduler | an in-process 30 s timer started from `instrumentation.ts` (`AUTOMATIONS_SCHEDULER=off` disables it) |
| External timer | `POST /api/automations/tick`, with `x-automations-token` when `AUTOMATIONS_TOKEN` is set |
| Old files | entries written before kinds existed load as Team tasks; an entry with a kind the code does not know is dropped, not run as something else |

A serverless host has no durable disk and no long-lived timer. On Vercel the Automations screens work, but unattended scheduling needs the Render deployment (`render.yaml`) or an external timer calling `/tick`. See [DEPLOY.md](DEPLOY.md).

## Seeing the unattended work

* **Dashboard** (artifact tab): automation reliability heat map, run-time candlesticks, agents used, where promised money went (waterfall), outcomes, verdict activity.
* **Timeline** (artifact tab and `/timeline`): a lane per automation with finished and planned runs, Proctor checks and verdicts, plus "Up next" with **Run now**.
* UltraPal gets the same data as CSV (`app/automations.csv`, `app/automation-runs.csv`), so you can ask it "which of my automations is flaky?" and it answers from real rows.

## Bugs found by running it

* After the schema gained a field, the dev server kept serving old-shaped entries and the sidebar threw. Every place that reads a kind from the network now falls back to Team task.
* A delete confirmation on the Automations page is two clicks, because a script that clicks twice deletes.
* A planner that used every round without answering was reported as a finished run. An automation now records it as an error (`NO_FINAL_ANSWER`).

Code: `lib/automations/*` (8 test files), `components/automations/*`, `app/api/automations/*`.
