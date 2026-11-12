# The 3-minute tour

**Meet UltraPals: a lead agent with terminal, browser and research pals, sandbox pals, and super pals, each a master of its own domain, with effort levels that make them stronger.** One idea runs through every beat: *agents get every freedom except the one that moves money. That stays a function.*

Live on Render: <https://ultrapals.onrender.com> · Code: <https://github.com/abhyudaya874-ai/ultrapals>

## The family in one breath

Say the first line over these. Every name is real and shows up in the app.

| Pals | What they are | Where you will see them |
|---|---|---|
| **UltraPal** | the lead: plans, delegates, answers | every run |
| **TerminalPal, BrowserPal, ResearchPal** | the working pals. A shell and a live browser in a real cloud sandbox, and Tavily + Exa research | 0:29 and the Battle teams |
| **SandboxPals** | one per payment sandbox. Real checks against Stripe test mode and Square's sandbox, read-only on PayPal's | 2:30 |
| **Super pals** | PayPal's eight rivals (Stripe, Shopify, Apple Pay, Adyen, Wise, Klarna, x402, Square) turned into examiners, with a frozen roster and cited bars | the Case Desk and the Deal exam |
| **PromisePal** | creates and settles a PayPal sandbox promise. It asks the money route; it cannot decide | 2:40 |
| **Specialists** | RivalPal (Deal exam), SituationPal (Case Desk), Proctor (scheduled canary) | the Case Desk at 2:30 |

## How to read this

* **Say** is the spoken line. About 345 spoken words in all, and no row needs more than about 145 a minute.
* **On screen** quotes the exact text the app prints at that moment (`Searching Tavily: …`, `Writing the answer with gpt-oss-120b on groq`). Name the tech when you see its line. [Say it when you see it](#say-it-when-you-see-it) lists the one-breath explanation for each, for the stretches you fast-forward.
* **Do** is the click. *Fast-forward* means cut in the edit: real runs take minutes on free-tier models.
* Record in a normal browser window so the **address bar shows `ultrapals.onrender.com`**. That is your proof it is live, not a local build.

## Before you record (15 minutes)

| Do | Why |
|---|---|
| Open the live URL at 1600 x 1000, dark theme. Collapse the sidebar (top-left icon) | the History list holds old test promises; keep them out of frame |
| Set the effort pill to **High** and the mode to **Chat** | High leads with GPT-OSS 120B, so the status line usually reads "Writing the answer with gpt-oss-120b on groq". If it names another model, **say that model's name**: always say what the screen says |
| Run the **Battle**, the **Loop** and the **Case Desk** question once beforehand and leave them in History | they save themselves. You reopen them instantly and never wait on camera. The Case Desk takes about 3 minutes and has run clean on the live site |
| Run `Unlock the premium Newsroom story about micropayment economics and summarise it` once | gives you a real promise to press **Replay verdict** on |
| Open the Render dashboard in another tab (service `ultrapals`, status *Live*, Starter) | a 2-second cut at the end |
| Keep `docs/img/` handy | a safe still if a free provider has a bad minute |

If a run is slow or a model is down, switch the pill to **Light** or **Ultra** (they lead with other models) and go again. If the day's demo budget is used up the app says so in one line (see [DEPLOY.md](DEPLOY.md)); record from the saved runs.

## 0:00 to 0:45 · The overview, the existing problem, then the team

| Time | On screen | Say | Do |
|---|---|---|---|
| 0:00 | A 3-second cut to the README's **Ultra, Super and normal Pals** diagram, then the live site | "Meet UltraPals: a lead agent with terminal, browser and research pals, sandbox pals, and super pals." | show the diagram, cut to the home screen |
| 0:07 | The live site, address bar `ultrapals.onrender.com` | "PayPal moves one point seven nine trillion dollars a year, yet says agents won't move its 2026 growth. Nobody trusts an agent with a wallet. Between 'it decided' and 'money moved' is a prompt." | hold on the home screen |
| 0:21 | The effort pill: Light, Standard, High, Ultra | "We figured out that line should be a function. Pals master their own domains, effort levels make them stronger. Live on Render." | open the pill, rest on **High**, close |
| 0:31 | `Starting a cloud computer`, then `Searching Tavily: …` and `Searching Exa: …` together, then `Writing the answer with gpt-oss-120b on groq` | "Live search on Tavily and Exa in parallel, the answer written by GPT-OSS 120B on Groq." | paste, send: `Open https://example.com in the browser and tell me its main heading. Then in the terminal run node -v and uname -a. Also research what HTTP 402 Payment Required is used for.` *Fast-forward the cloud computer's 10 second boot* |
| 0:38 | The live browser; the terminal's `Running node -v && uname -a`; the ring spinning with a count like `6.2K` | "TerminalPal and BrowserPal work in real cloud sandboxes. And this ring adds up the whole team, live." | hover the ring, click **Show all tool calls**, click an agent to open its own panel |

## 0:45 to 1:20 · Battle: an answer has to be earned

| Time | On screen | Say | Do |
|---|---|---|---|
| 0:45 | The **Chat** pill becoming **Battle** | "One confident agent is the failure mode. So: Battle." | switch the mode; paste `Which is cheaper for a $0.25 purchase in the US, Stripe or Square? Use their published fee pages.` |
| 0:50 | Team panels filling, one context ring per team, each ring's card naming a different model | "Teams argue opposite predictions on different model families, GPT-OSS on Groq, Nemotron on NVIDIA, each in its own cloud sandbox." | *fast-forward*; hover a team's ring once and read the model names off its card, whatever they are |
| 1:01 | The bracket, then the hit animation | "A blind judge scores them, then a knockout. The fight is arithmetic, not animation." | open the saved Battle, **Bracket** tab |
| 1:10 | **Results**: champion, score, "why it won" | "Every sentence on this screen is generated from the numbers, so every sentence is true." | **Results** tab, scroll slowly |

## 1:20 to 2:00 · Loop: get better on purpose

| Time | On screen | Say | Do |
|---|---|---|---|
| 1:20 | The saved Loop's rail of round orbs | "A Battle compares. A Loop improves." | open the saved Loop |
| 1:26 | Round 2's orb flying in with a score and a change | "Each round attacks the weakest point of the best answer so far, and is told exactly what it must beat." | hover an orb for its popover |
| 1:40 | The diff between rounds: scenario, score per measure, sites added and dropped | "We figured out 'it got better' is a claim, so the screen shows what changed: which measures moved, which sources were added." | point at the change chips |
| 1:52 | The stop reason | "It stops when a score of eight isn't beaten, or two rounds go flat." | |

## 2:00 to 2:30 · Automations: pals that work while you sleep

| Time | On screen | Say | Do |
|---|---|---|---|
| 2:00 | The Automations page, eight kinds | "Eight kinds of unattended work, from research briefs and page watches to a Battle on a schedule." | open the page |
| 2:08 | The form filling in | "We figured out unattended agents are a spending risk, so every kind has ceilings no prompt can lift." | create: `Every morning at 9, open Stripe's pricing page and tell me when the card fee changes` |
| 2:18 | The new automation in the list, with its next run | "Money is denied inside every run, a schedule needs your own time word, and it runs on the server's own timer, saved on Render's disk." | |

## 2:30 to 3:00 · Multiple sandboxes, the money, and where it runs

| Time | On screen | Say | Do |
|---|---|---|---|
| 2:30 | The saved Case Desk result: **Sandbox checks (real calls to each test environment)**, a PayPal, Stripe and Square table | "Multiple sandboxes. One question, three payment rails. Real calls to Stripe test mode and Square's sandbox, read-only checks on PayPal's, every claim cited." | scroll to the table; the status of the run showed `Ran Stripe sandbox checks`, `Ran Square sandbox checks`, `Ran PayPal sandbox checks` |
| 2:40 | A promise page; **Replay verdict** answering *identical* | "Money moves only through a pure function agents can't import. Replay: identical." | open the Newsroom promise, press **Replay verdict** |
| 2:46 | The README test badge | "2,255 tests. 'Could not see' is always wait, never release." | scroll the README header |
| 2:51 | Cut to the Render dashboard (`ultrapals`, *Live*), then the end card with the stack line below | "All of it live on Render, built by a student in India on free tiers. Try it." | end card, held for the last 4 seconds |

**End card stack line** (text on screen, not spoken): Next.js 15 · TypeScript · Neon Postgres · Drizzle · Render (Singapore) · KERNEL cloud sandboxes · PayPal sandbox · Stripe test mode · Square sandbox · Groq GPT-OSS 120B · NVIDIA Nemotron · OpenRouter free models · Tavily + Exa · AG Studio · Bryntum

## Say it when you see it

Each row is one breath. Use them over the fast-forwarded stretches, in the order the screen shows them.

| When the screen shows | Say |
|---|---|
| `Searching Tavily: …` and `Searching Exa: …` together | "Live search on Tavily and Exa in parallel, merged and de-duplicated, so one provider's gap doesn't leave a hole." |
| `Reading developer.paypal.com` | "It fetches the real page behind an SSRF guard, and a claim survives only if its quote is on that page." |
| `Writing the answer with gpt-oss-120b on groq` | "The answer is written by GPT-OSS 120B on Groq, streamed token by token." |
| `Starting a cloud computer` | "A real cloud Chromium and shell on KERNEL, one per conversation, deleted when you are done or after eight idle minutes." |
| The ring card: `Hearing nemotron-3.5-lightning-30b-a3b` or `Waiting to hear from …` | "A roster of free models across Groq, NVIDIA and OpenRouter rotates, and two race on every call. The ring shows which one each pal is on." |
| `Blind check by a different model family` (Case Desk) | "A second model family sees only the typed grid and has to agree." |
| `Ran Stripe sandbox checks` and `Ran Square sandbox checks` | "Real calls to the test environments. PayPal's check is read-only, because no pal holds a PayPal write tool." |
| A promise trace | "Postgres on Neon, append-only. The verdict is stored with its input before any money moves." |
| The address bar | "That is a Render web service in Singapore, always on, with hard daily caps so a public link can't run up a bill." |

## Lines that land (use any, keep them short)

* "Between 'the agent decided' and 'money moved' there should be a function, not a prompt."
* "Agents can have every freedom except the one that moves money."
* "We figured out a verdict you can't replay can't be audited. So every verdict stores its own input."
* "We figured out 'I checked' proves nothing. So a claim survives only if its quote is in a page we actually fetched."
* "Blind is not the same as no. If we couldn't see, the answer is **wait**."
* "One confident agent is a failure mode."

## If asked

| Question | Short answer |
|---|---|
| What are the "multiple sandboxes"? | Two real things. Every Battle team runs on its **own cloud computer**. And the Case Desk runs the same four structural checks (typed error, idempotent retry, server-side charge, refund read-back) against **Stripe test mode and Square's sandbox**, with PayPal checked read-only. In the live run we saved it read 9 of 12 passing, with PayPal's three write checks honestly marked "not measurable" |
| What is fetched live? | Tavily and Exa searches run in parallel on every research step, and the pages are read at that moment. Nothing is cached or canned |
| Which models? | A ten-model roster in the code, of which six are active on the live site (Bluesminds, the credit-funded gateway, is off there): Groq (GPT-OSS 20B and 120B), NVIDIA (Nemotron) and OpenRouter (free models only). The effort pill chooses which lead and how many race |
| Where does it run, and what does it cost? | Render, Singapore, Starter instance, about $7 a month against the hackathon credit. A full Battle peaked at 178 MB of its 512 MB. [DEPLOY.md](DEPLOY.md) |
| Can the public run up a bill? | No. Hard caps: 6 cloud computers at once and 150 a day, 250 messages and 30 contests a day. Bluesminds, the one credit-funded model gateway, is switched off in the live demo |
| Is anything here not real? | The money is PayPal **sandbox**, on purpose. Elastic, Zapier, Astropods and the Render Workflows sweep are built and tested but switched off. [INTEGRATIONS.md](INTEGRATIONS.md) says what was and was not verified |
| Who else does this? | Neighbours exist for each piece (AP2, Visa and Mastercard agent programs, Skyfire, Payman, PayPal Doctor, Gauntlet). We claim the combination, and [LANDSCAPE.md](LANDSCAPE.md) names them and lists what we are not good at |
| What is it worth to PayPal? | A labelled sensitivity model, not a forecast: roughly $90M to $140M a year attributable under conservative assumptions, with billions of margin at stake. [PAYPAL-IMPACT.md](PAYPAL-IMPACT.md) |
| Why is it sometimes slow? | Free-tier models rate-limit. The app rotates them, races two per call and drops one that is silent for 15 seconds |
| Can a pal touch money? | No. The tool list has no PayPal, database or money member at any depth, and `check-invariants` fails the build if an agent mentions `computeVerdict` |

## Cut order if you run long

Automations (2:00 to 2:30) → the Loop's stop reason (1:52). The Deal exam and the SuperPals are not in the timed tour: show them only if asked. **Never cut** the ring (0:38), the Battle's blind judge (1:01), the sandbox table (2:30), the replay (2:40) or the "wait, never release" line (2:46).
