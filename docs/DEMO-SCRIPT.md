# The 3-minute tour

**Meet UltraPals: a lead agent, and pals that are masters of their own domains, like TerminalPal, with effort levels that make them stronger.** One idea runs through every beat: *agents get every freedom except the one that moves money. That stays a function.*

Live app: <https://ultrapals.onrender.com> · Code: <https://github.com/abhyudaya874-ai/ultrapals>

About 370 spoken words, never more than about 150 a minute in any section. The Battle and Loop sections are deliberately light so the screen can talk. Everything marked *fast-forward* is cut in the edit; real Battles and Loops take minutes on free-tier models.

## Before you record (10 minutes)

| Do | Why |
|---|---|
| Open the live URL in a fresh window at 1600 x 1000, dark theme. Collapse the sidebar (top-left icon) | the History list holds old test promises; keep them out of frame |
| Run the **Battle** and the **Loop** once beforehand and leave them in History | they save themselves, so you can reopen the finished result instantly and never wait on camera |
| Warm the server with one click on the home page | Starter instances are always on, but the first cloud computer takes about 10 seconds |
| Have the effort pill on **Standard** and the mode on **Chat** | the first frame |
| Keep `docs/img/` open in another window | a safe still if a free provider has a bad minute |

If a run is slow or a model is down: switch the effort pill to **Light** or **High** (they lead with a different model) and go again. If the day's demo budget is used up the app says so in one line (see [DEPLOY.md](DEPLOY.md)); record from the saved runs instead.

## 0:00 to 0:45 · Chat: the team and what it costs

| Time | On screen | Say | Do |
|---|---|---|---|
| 0:00 | Home screen | "An AI agent that can click **Pay** is one hallucination away from your savings. Today the only thing between that agent and your money is a prompt." | hold on the home screen |
| 0:08 | Click the effort pill: Light, Standard, High, Ultra | "Meet **UltraPals**. A lead agent, and pals that are masters of their own domains, with **effort levels** that make them stronger." | slide to **High**, close |
| 0:16 | Paste the prompt, send | "Ask it to build something." | `Build a tiny landing page in the terminal and open it in the browser` |
| 0:20 | Thread: BrowserPal starts a cloud computer; TerminalPal writes files as green and red diffs; the live browser opens | "**TerminalPal** works in a real cloud computer. **BrowserPal** opens the result in a real browser, and you can watch it." | *fast-forward the 10 second boot* |
| 0:32 | Hover the **ring** beside the effort pill. Click **Show all tool calls** | "We figured out nobody can see what an agent team *costs*. So this ring adds up the **whole team**, token by token, live, and every pal has its own panel." | card open, expand, click an agent row to show its panel |
| 0:42 | Ring still spinning | *(let it run; no words)* | |

## 0:45 to 1:20 · Battle: an answer has to be earned

| Time | On screen | Say | Do |
|---|---|---|---|
| 0:45 | Switch **Chat** to **Battle**; type the question | "One confident agent is the failure mode. So we built **Battle**." | `Which is cheaper for a $0.25 purchase in the US, Stripe or Square? Use their published fee pages.` |
| 0:52 | Team panels filling, one ring per team | "Teams argue **opposite predictions**, each on a **different model family**, each on its own cloud computer." | *fast-forward the run* |
| 1:02 | Bracket, then the hit animation | "A **blind judge** scores them. Then a knockout. The fight is **arithmetic**, not animation: health, damage per measure, armour per cited source." | open the saved Battle: **Bracket** tab |
| 1:12 | Results: champion, score, "why it won" | "Every sentence here is generated from the numbers, so every sentence is true." | **Results** tab, scroll slowly |

## 1:20 to 2:00 · Loop: get better on purpose

| Time | On screen | Say | Do |
|---|---|---|---|
| 1:20 | Switch to **Loop**; the saved Loop's rail of round orbs | "A Battle compares. A **Loop improves**." | open the saved Loop |
| 1:28 | Round 1, then Round 2 flies in with a score and a change | "Each round attacks the **weakest point** of the best answer so far, and is told exactly **what it must beat**." | hover an orb for its popover |
| 1:42 | The diff between rounds: scenario, score per measure, sites added and dropped | "We figured out that 'it got better' is a claim, so the screen shows **what changed**: which measures moved, which sources were added." | point at the change chips |
| 1:52 | Stop reason | "It stops when a score of 8 or more isn't beaten, or two rounds go flat. Not when it's bored." | |

## 2:00 to 2:30 · Automations: pals that work while you sleep

| Time | On screen | Say | Do |
|---|---|---|---|
| 2:00 | **Automations** page, the eight kinds | "Eight kinds of **unattended** work: research briefs, page watches, rail checks, deal exams, even a Battle on a schedule." | open the page |
| 2:10 | Create a **Page watch** for Stripe's pricing page | "We figured out unattended agents are a spending risk, so every kind has ceilings **no prompt can lift**." | `Every morning at 9, open Stripe's pricing page and tell me when the card fee changes` |
| 2:20 | The list and the ceilings | "Money is denied inside every run. A schedule only exists if **you** used a time word. A web page can't talk it into one." | |

## 2:30 to 3:00 · The part that moves money, and what's behind it

| Time | On screen | Say | Do |
|---|---|---|---|
| 2:30 | Promise page: **Replay verdict** | "Now the part that moves money. A **pure function** decides, and a build check forbids every agent from even importing it. Replay: **identical**." | open a promise (the Newsroom unlock you ran earlier), press **Replay verdict** |
| 2:40 | Test badge and the ten invariants | "**2,255 tests.** And 'could not see' is always **wait**, never release." | scroll the README header |
| 2:46 | Impact table in the README | "Billions of margin ride on agent commerce. A trust layer is worth roughly **ninety to a hundred and forty million a year** to PayPal. Every assumption is shown." | scroll to the table |
| 2:55 | Live URL and repo on screen | "Built by a student in India, on free tiers. Try it." | end card |

## Lines that land (use any, keep them short)

* "Agents can have every freedom except the one that moves money."
* "We figured out a verdict you can't replay can't be audited. So every verdict stores its own input."
* "We figured out 'I checked' proves nothing. So a claim survives only if its quote is in a page we actually fetched."
* "Blind is not the same as no. If we couldn't see, the answer is **wait**."
* "One confident agent is a failure mode."

## If asked

| Question | Short answer |
|---|---|
| Is anything here not real? | The money is PayPal **sandbox**, on purpose. Elastic, Zapier, Astropods and the Render Workflows sweep are built and tested but switched off in the live demo. [INTEGRATIONS.md](INTEGRATIONS.md) says exactly what was and wasn't verified |
| Who else does this? | Neighbours exist for each piece (AP2, Visa and Mastercard agent programs, Skyfire, Payman, PayPal Doctor, Gauntlet). We claim the combination, and [LANDSCAPE.md](LANDSCAPE.md) names them and lists what we are not good at |
| What does it cost to run? | About $7 a month on Render, covered by the hackathon credit, with hard daily caps on everything that could bill. [DEPLOY.md](DEPLOY.md) |
| Why is it sometimes slow? | Free-tier models rate-limit. The app rotates ten of them, races two per call and drops one that is silent for 15 seconds |
| Can a Pal touch money? | No. The tool list has no PayPal, database or money member at any depth, and `check-invariants` fails the build if an agent mentions `computeVerdict` |

## Cut order if you run long

Automations (2:00 to 2:30) → the Loop's stop reason (1:52). The Deal exam and the SuperPals are not in the timed tour at all: show them only if asked. **Never cut** the ring (0:32), the Battle's blind judge (1:02), the replay (2:30) or the "wait, never release" line (2:40).
