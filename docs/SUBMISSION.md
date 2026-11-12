# UltraPals: AI Pals That Work, Code Decides the Money

> Agents battle. Code moves the money.

Project story for the hackathon submission form. The form accepts Markdown and LaTeX.

**Elevator pitch (191 of 200 characters):** AI teams research, browse and run code, then battle: a blind judge crowns the best answer. Only a pure, replayable verdict function can move PayPal sandbox money. Agents gather. Code decides.

## Inspiration

PayPal has 439 million accounts, and on its Q4 2025 call management said agentic commerce "won't materially impact 2026 growth." We think the reason is trust. Today the line between "the model thought it was fine" and "money left the account" is a prompt, and a prompt can be argued with. So we made that line a function.

## What it does

UltraPals is an AI team that can do real work and cannot decide where money goes.

- **UltraPal** is the lead agent. It sends out Pals: ResearchPal (Tavily and Exa), BrowserPal (a live cloud Chromium), and TerminalPal (a shell in the same VM).
- **Battle** puts 2 to 6 teams, each on a different model family, on opposite predictions. A blind judge scores their reports and a knockout bracket picks the winner.
- **Loop** runs rounds where each one attacks the weakest point of the best answer so far.
- **Automations** run Pals on a schedule inside hard ceilings. They can't move money or create more automations.
- **The money path** has a payer commit an amount and an optional condition about the world. A pure function returns `CAPTURE`, `RELEASE` or `WAIT`, and one route performs it against the PayPal sandbox. **Replay verdict** gives the identical answer later.
- **Deal exam and Case Desk** attack a deal with hostile scenarios, and compare PayPal against Stripe and Square with cited answers.
- **A live context ring** adds up tokens for the whole team as it streams.

## How we built it

- **Stack:** Next.js 15, TypeScript (strict), Tailwind, Drizzle on Neon, deployed on Render.
- **Pure verdicts:** `lib/verdict.ts` imports nothing, reads no clock and calls no network. Time comes in as `nowMs`. Money is integer minor units.
- **Agents can't decide:** build-failing checks stop any agent code from importing the verdict function. A vendor failure degrades to `WAIT`, never `RELEASE`.
- **Models:** a roster across Groq, NVIDIA, OpenRouter and Bluesminds, behind an allowlist, with cooldowns and hedged races.
- **Tools:** cloud browsers and terminals run on Kernel, with search from Tavily and Exa.
- **Judging:** a Battle score combines counted facts and the blind judge's marks:

$$S = 0.4\,D + 0.6\,J, \qquad D,\, J \in [0, 10]$$

Here \( D \) is counted by code (sources cited, files written, finishing cleanly) and \( J \) is the judge's score. A Loop stops when the best score is at least 8 and the next round doesn't beat it, after two flat rounds, or at the round limit.

## Challenges we ran into

- **Free-tier models fail constantly.** Groq's daily token limits, OpenRouter's 50 requests a day, and models that stall or cut off mid-JSON all hit us. Our first real 4-team Battle ended with only 1 report in 4.
- **Four separate causes.**
  - A reply cut off at the timeout was treated as a finished answer.
  - Long delegation tasks were rejected.
  - Team time limits threw away work that had come back.
  - Teams shared too few models.
- **The fix:** we rebuilt the routing so a broken reply goes to the next model. Long text is trimmed instead of rejected. Helper agents stop in time for the report to be written. A team that never wrote a report is judged on what its Pals found. The same Battle now ends with 4 reports and 4 judged matches.
- **Honest degradation.** Blind observers, missing keys and rate limits all have to produce `WAIT` or `NOT_MEASURABLE`, never a fake pass.

## Accomplishments that we're proud of

- The line between "agents act" and "money moves" is enforced by the build, not by a prompt.
- Every verdict stores its own input and replays identically.
- More than 2,500 tests pass, plus a full production build, as one gate.
- Battle and Loop produce answers a person can audit: opposite predictions, a blind judge, and results explained from the numbers.
- A live deployment on Render with spending caps, so a public link can't run up a bill.

## What we learned

- "Couldn't see" is not "no." A blind observer must produce `WAIT`.
- A claim an agent makes proves nothing. A claim whose quote appears word for word in a page it fetched is evidence.
- Most agent failures are plumbing, not intelligence: timeouts, formats, rate limits and lost work.
- Measuring a real run beats guessing.

## What's next for UltraPals

- Run Battle and Loop on paid or dedicated model capacity, so results don't depend on free-tier luck.
- Add more rail examiners and more saved evaluation scenarios.
- Offer verdict replay and the pure function as a small library merchants can audit themselves.
- Move from sandbox integrations toward a reviewed path for production payments.

## Built with (25 tags)

`typescript` · `nextjs` · `react` · `tailwindcss` · `paypal-sandbox` · `drizzle-orm` · `neon` · `postgresql` · `vitest` · `zod` · `render` · `kernel` · `tavily` · `exa` · `groq` · `nvidia-nim` · `openrouter` · `gpt-oss` · `nemotron` · `qwen` · `channel3` · `ag-studio` · `bryntum` · `stripe` · `square`

## Try it out

- Live demo: <https://ultrapals.onrender.com>
- Code: <https://github.com/abhyudaya874-ai/ultrapals>
