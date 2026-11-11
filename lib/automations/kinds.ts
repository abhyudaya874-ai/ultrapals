import type { PresetId } from "./presets";

/**
 * What an automation can be. Pure data: the server reads the limits and how a run starts, the Automations page reads the labels and the
 * ideas. Every kind runs unattended, so every kind has its own spending bounds: a Battle opens several cloud computers at once and is
 * allowed far less often than a page check.
 */
export const KINDS = ["task", "research", "browser", "watch", "rails", "exam", "battle", "loop"] as const;
export type Kind = (typeof KINDS)[number];
export const DEFAULT_KIND: Kind = "task";

/** The agent that goes first when the kind is one agent's job (the planner still writes the report). */
export type FirstAgent = "research" | "browser" | "situation" | "rival";

export interface KindInfo {
  label: string;
  blurb: string;
  placeholder: string;
  /** Shortest repeat interval ("every N minutes"), in minutes. */
  minMinutes: number;
  /** Most runs that may start in 24 hours. */
  dailyCap: number;
  /** A run is stopped after this long. */
  timeoutMs: number;
  /** Several teams, each with its own cloud computer, at once. Only a few may be switched on. */
  heavy: boolean;
  first: FirstAgent | null;
  /** Delegates this kind may not use, on top of the ones no automation may use. */
  deny: readonly string[];
  /** A Battle's teams or a Loop's rounds. */
  count?: { label: string; min: number; max: number; default: number };
}

const MIN = 60_000;
export const KIND_INFO: Record<Kind, KindInfo> = {
  task: { label: "Team task", blurb: "UltraPal and the whole team do it: research, browsing, terminal work and files.", placeholder: "Describe what you want done: research, run commands, browse, save files…", minMinutes: 30, dailyCap: 12, timeoutMs: 8 * MIN, heavy: false, first: null, deny: [] },
  research: { label: "Research brief", blurb: "ResearchPal searches the web and writes a short brief with its sources.", placeholder: "What should it research? Name the topic and what to look for…", minMinutes: 30, dailyCap: 12, timeoutMs: 8 * MIN, heavy: false, first: "research", deny: ["browser", "terminal", "rival", "situation"] },
  browser: { label: "Browser task", blurb: "BrowserPal opens a page and does something there: search, scroll, read, collect.", placeholder: "Say which page to open and what to do there. Include the address…", minMinutes: 30, dailyCap: 12, timeoutMs: 8 * MIN, heavy: false, first: "browser", deny: [] },
  watch: { label: "Page watch", blurb: "BrowserPal re-reads a page and says what changed since the last run.", placeholder: "Which page to watch, and what to look at on it. Include the address…", minMinutes: 30, dailyCap: 12, timeoutMs: 8 * MIN, heavy: false, first: "browser", deny: [] },
  rails: { label: "Rail check", blurb: "SituationPal compares PayPal with other payment rails for your idea, with sandbox checks.", placeholder: "Describe the product or idea, who pays, how much and where…", minMinutes: 60, dailyCap: 6, timeoutMs: 10 * MIN, heavy: false, first: "situation", deny: [] },
  exam: { label: "Deal exam", blurb: "RivalPal stress-tests a deal or promise and reports SEALED, CONDITIONAL or REFUSED.", placeholder: "Describe the deal in plain words: who pays what, when, and what releases it…", minMinutes: 60, dailyCap: 6, timeoutMs: 8 * MIN, heavy: false, first: "rival", deny: [] },
  battle: { label: "Battle", blurb: "Teams with different methods answer the same question; a blind judge picks the winner.", placeholder: "The question the teams should answer. Pick one where methods can disagree…", minMinutes: 360, dailyCap: 3, timeoutMs: 15 * MIN, heavy: true, first: null, deny: [], count: { label: "Teams", min: 2, max: 4, default: 3 } },
  loop: { label: "Loop", blurb: "Rounds on different scenarios, each aimed at the weakest point of the best answer so far.", placeholder: "The question to sharpen over several rounds…", minMinutes: 360, dailyCap: 3, timeoutMs: 15 * MIN, heavy: true, first: null, deny: [], count: { label: "Rounds", min: 2, max: 4, default: 3 } },
};

/**
 * Who works on each kind, the one that does the job first at the front. Role names are the Pals (main is UltraPal); `c1-pragmatist` and `r1-rigorist`
 * are the teams of a Battle and the rounds of a Loop, which UltraPal runs. The Automations page draws them as a stack of orbs, front one on top.
 */
export const TEAM_OF: Record<Kind, readonly string[]> = {
  task: ["main", "research", "browser", "terminal"],
  research: ["research", "main"],
  browser: ["browser", "main"],
  watch: ["browser", "main"],
  rails: ["situation", "research", "main"],
  exam: ["rival", "research", "main"],
  battle: ["main", "c1-maximalist", "c2-skeptic", "c3-pragmatist"],
  loop: ["main", "r1-rigorist", "r2-contrarian", "r3-compliance"],
};

/** At most this many heavy automations (Battles and Loops) may be switched on at once: each run opens a cloud computer per team. */
export const MAX_HEAVY_ON = 2;

export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
/** Pure. A kind read from stored or posted data; anything unknown is a Team task (files written before kinds existed have none). */
export const kindOf = (v: unknown): Kind => (isKind(v) ? v : DEFAULT_KIND);
export const dailyCapFor = (k: Kind): number => KIND_INFO[k].dailyCap;
export const timeoutFor = (k: Kind): number => KIND_INFO[k].timeoutMs;
/** A run claimed longer ago than this is treated as dead (the server restarted mid-run) and may be started again. */
export const staleFor = (k: Kind): number => KIND_INFO[k].timeoutMs + 2 * MIN;
/** Pure. How many teams or rounds a Battle or Loop gets when the automation does not say. */
export const countFor = (k: Kind, n: number | undefined): number | undefined => {
  const c = KIND_INFO[k].count;
  return c ? Math.max(c.min, Math.min(c.max, n ?? c.default)) : undefined;
};

export interface Idea {
  title: string;
  blurb: string;
  prompt: string;
  preset: PresetId;
  count?: number;
}
/**
 * Good first automations for each kind. Each one is a job whose answer is worth coming back to, written so it works with nobody watching
 * (it names the page or the topic, and says what to report). Battles and Loops use questions where different methods can really disagree.
 */
export const IDEAS: Record<Kind, Idea[]> = {
  task: [
    { title: "Payment rails watch", blurb: "Re-compare PayPal, Stripe and Square for micro-payments and flag what changed.", prompt: "Compare PayPal, Stripe and Square fees and limits for payments under one dollar. Save the comparison as rails.csv, and say what changed compared with the last run if you can see an earlier rails.csv.", preset: "daily" },
    { title: "Sandbox health check", blurb: "Open the Proctor artifact and report any new case or changed check.", prompt: "Open the proctor artifact. Report whether any check changed or any case is open, and name the rail and check. If nothing changed, say so in one line.", preset: "6h" },
    { title: "Morning payments briefing", blurb: "Five stories that matter for online payments, one line each, with links.", prompt: "Search for the five most important news stories from the last day about online payments, stablecoins and fintech regulation. Write a briefing with one line per story and its link, and save it as briefing.md.", preset: "weekdays" },
  ],
  research: [
    { title: "Competitor brief", blurb: "What Stripe, Square and Adyen changed this week, and what it means for a PayPal merchant.", prompt: "Research what Stripe, Square and Adyen announced or changed this week: pricing, APIs, fees, new countries. Write a cited brief of at most 200 words and end with what matters for a PayPal merchant.", preset: "weekly" },
    { title: "Hackathon opportunity tracker", blurb: "New hackathons with a payments or agents track, saved as a CSV.", prompt: "Search for hackathons with a payments, fintech or AI-agents track whose deadline is in the next 30 days. Save them as hackathons.csv with name, deadline, prize and link, and summarise the three best fits.", preset: "weekdays" },
    { title: "Regulation radar", blurb: "New rules on stablecoins, instant payments or card fees in the EU, UK and US.", prompt: "Find new rules, guidance or consultations from the last week on stablecoins, instant payments or card fees in the EU, UK and US. For each give the date, the source and one line on who it affects.", preset: "weekly" },
  ],
  browser: [
    { title: "Read a pricing page", blurb: "Open Stripe's pricing page and report the card fee and the payout fees.", prompt: "Open https://stripe.com/pricing. Report the standard fee for an online card payment in the United States and the fee for instant payouts, quoting the text you saw. Dismiss any cookie banner first.", preset: "daily" },
    { title: "API changelog", blurb: "Read the newest entries of an API changelog and list what changed.", prompt: "Open https://docs.stripe.com/changelog. Read the five newest entries and list what changed, with the date of each.", preset: "weekdays" },
    { title: "Status page check", blurb: "Open PayPal's status page and name any incident that is open right now.", prompt: "Open https://www.paypal-status.com. Report whether any service shows an incident or degraded performance right now, and name it. If everything is normal, say so in one line.", preset: "1h" },
  ],
  watch: [
    { title: "Fee page watch", blurb: "Tell me when a processor's published card fee changes.", prompt: "Open https://stripe.com/pricing and note the standard online card fee and the instant payout fee, quoting the text you saw.", preset: "daily" },
    { title: "Status page watch", blurb: "Tell me when PayPal's status page shows a new incident.", prompt: "Open https://www.paypal-status.com and note every service that is not operating normally, with the wording used.", preset: "1h" },
    { title: "Docs change watch", blurb: "Tell me when a docs page adds or removes something.", prompt: "Open https://developer.paypal.com/docs/api/orders/v2/ and list the operations and the version shown on the page.", preset: "weekdays" },
  ],
  rails: [
    { title: "Micropayments rail check", blurb: "Which rail fits a $0.01 to $0.25 pay-per-article site with readers worldwide?", prompt: "A news site charges between $0.01 and $0.25 per article with no subscription, to readers in more than 50 countries. Which payment rail fits best, and what do the fees look like at those prices?", preset: "weekly" },
    { title: "Marketplace payouts", blurb: "Paying freelancers in 40 countries every week.", prompt: "A marketplace for freelance designers collects payments from clients and pays the designers in 40 countries every week. Which rail handles payouts and holds best, and what does it cost?", preset: "weekly" },
    { title: "Subscription box", blurb: "A $24 monthly box, mostly US customers, with disputes to worry about.", prompt: "A subscription box charges $24 a month, 80 percent of customers are in the US, and chargebacks are the main worry. Which payment rail is the best fit, and why?", preset: "weekly" },
  ],
  exam: [
    { title: "Delivery-release deal", blurb: "Pay a designer when the final files arrive, refund if late.", prompt: "Examine this deal: I pay a designer $400. The money is released when the final logo files are delivered within 7 days, and returned to me if they are late.", preset: "weekly" },
    { title: "Paywall promise", blurb: "A reader pays $0.50, refunded if the promised chart is missing.", prompt: "Examine this deal: a reader pays $0.50 to unlock an article. It is refunded if the page does not contain the chart the headline promised within 10 minutes.", preset: "weekly" },
    { title: "Price-drop promise", blurb: "Commit $120 for a keyboard, captured only if the price is $120 or less by Friday.", prompt: "Examine this deal: I commit $120 for a keyboard. The money is captured only if the product page shows a price of $120 or less by Friday, otherwise it is released.", preset: "weekly" },
  ],
  battle: [
    { title: "Cheapest rail for tiny payments", blurb: "Teams disagree on which rail is cheapest for a $0.25 purchase; the fee pages decide.", prompt: "Which payment rail has the lowest total cost for a $0.25 purchase in the US: PayPal, Stripe or Square? Use each one's published fee page and show the arithmetic.", preset: "weekly", count: 3 },
    { title: "Fee forecast", blurb: "Optimists and sceptics predict where card fees go over the next year.", prompt: "Will card processing fees for a US online merchant go up or down over the next 12 months? Give a prediction with a confidence and the evidence that would prove it wrong.", preset: "weekly", count: 3 },
    { title: "Refund window", blurb: "7 days or 30 days: which refund window costs a small shop less?", prompt: "For a small online shop selling digital goods, is a 7-day or a 30-day refund window cheaper overall once chargebacks and lost sales are counted? Show your reasoning.", preset: "weekly", count: 3 },
  ],
  loop: [
    { title: "Sharpen a pricing answer", blurb: "What a payments startup should charge per API call, attacked a round at a time.", prompt: "What should a payments API startup charge per call? Each round, attack the weakest assumption in the best answer so far and fix it.", preset: "weekly", count: 3 },
    { title: "Refund policy stress test", blurb: "A policy for a $0.01 paywall, tried against honest, abusive and regulated cases.", prompt: "Draft the refund policy for a $0.01 paywall and test it against abusive users, honest users and a regulator, one scenario per round.", preset: "weekly", count: 3 },
    { title: "Choice under change", blurb: "Re-test a rail choice when fees rise, a new country is added, disputes spike.", prompt: "Choose between PayPal and Stripe for a marketplace, then re-test the choice when fees rise, when a new country is added and when disputes spike.", preset: "weekly", count: 3 },
  ],
};
