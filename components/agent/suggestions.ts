import type { ModeKind } from "@/lib/arena/mode";

/**
 * What the home screen offers to try, for each mode. A good suggestion is one the mode can really show off:
 * - Chat: one job for each Pal, plus two that ask UltraPal to schedule something (it then makes a real automation).
 * - Battle: a question where methods can disagree and the web can settle it, so the teams defend different answers and the judge has evidence to weigh.
 * - Loop: a question whose first answer is never the best one, so each round has a weak point to attack.
 */
export interface Suggestion {
  text: string;
  /** Asks UltraPal to repeat something on a schedule; shown with a small tag. */
  automation?: boolean;
}

export const SUGGESTIONS_BY_MODE: Record<ModeKind, Suggestion[]> = {
  chat: [
    { text: "Compare PayPal, Stripe and Square for a marketplace that sells AI-written reports for a few cents each" },
    { text: "Examine this deal: I pay $200 on delivery of a logo design, refund if it is late" },
    { text: "Research how L402 pay-per-request works and save the findings as a CSV" },
    { text: "Build a tiny landing page in the terminal and open it in the browser" },
    { text: "Unlock the premium Newsroom story about micropayment economics and summarise it" },
    { text: "Every morning at 9, open Stripe's pricing page and tell me when the card fee changes", automation: true },
    { text: "Every Monday, research what Stripe, Square and Adyen announced this week and save a short brief", automation: true },
  ],
  battle: [
    { text: "Which is cheaper for a $0.25 purchase in the US: PayPal, Stripe or Square? Use each one's published fee page and show the arithmetic." },
    { text: "Will card processing fees for a US online merchant go up or down over the next 12 months? Give a prediction and what would prove it wrong." },
    { text: "For a small shop selling digital goods, is a 7-day or a 30-day refund window cheaper once chargebacks and lost sales are counted?" },
    { text: "Should a pay-per-article news site charge $0.01 or $0.25 an article? Which earns more once the fees are paid?" },
    { text: "Is it safer to hold a $200 payment until delivery is confirmed, or to release it at once and refund on complaint?" },
  ],
  loop: [
    { text: "Draft the refund policy for a $0.01 paywall, then test it against abusive users, honest users and a regulator, one in each round." },
    { text: "What should a payments API startup charge per call? Each round, attack the weakest assumption in the best answer so far." },
    { text: "Choose between PayPal and Stripe for a marketplace, then re-test the choice in each round: fees rise, a new country is added, disputes spike." },
    { text: "Write the one-paragraph pitch for a micropayment paywall, then sharpen it against the toughest objection each round." },
    { text: "Design a fraud check for $0.01 purchases that costs less than the fraud it stops, then try to break it in every round." },
  ],
};

/** What to say above the cards, so a person knows what makes a good Battle or Loop. Chat needs no explanation. */
export const SUGGESTION_CAPTION: Record<ModeKind, string> = {
  chat: "",
  battle: "Questions where teams can disagree and the web can settle it",
  loop: "Questions that get sharper every round",
};

export const suggestionsFor = (kind: ModeKind): Suggestion[] => SUGGESTIONS_BY_MODE[kind];

/** Pure. Whether clicking a suggestion starts it at once (a chat) or only fills the box (a Battle or Loop opens several cloud computers, so the person presses Enter). */
export const startsAtOnce = (kind: ModeKind): boolean => kind === "chat";
