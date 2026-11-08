/**
 * The Newsroom: a tiny publisher for the pay-per-request demo. Premium articles sit behind an HTTP 402 paywall;
 * access is a Standing Promise ($0.01) captured only when the article proves readable. Content is data, not code.
 */

export interface NewsArticle {
  slug: string;
  title: string;
  dek: string;
  premium: boolean;
  price: string; // decimal string, e.g. "0.01"
  currency: "USD";
  published: string; // ISO date
  body: string[]; // paragraphs
}

export const ARTICLES: NewsArticle[] = [
  {
    slug: "dev-days-2025-winners",
    title: "PayPal Dev Days 2025: the winning agentic-commerce projects",
    dek: "Three teams, three tracks, one theme: agents that move money.",
    premium: false,
    price: "0",
    currency: "USD",
    published: "2025-11-08",
    body: [
      "The PayPal Dev Days hackathon ran for just under 24 hours at PayPal's San Jose campus. Teams picked one of three tracks: Agentic Integrations, Vibe Coding with Replit, or Upgrade Your Legacy Integration.",
      "First place went to CrawlerPal, a paywall assistant for AI agents built on PayPal APIs. The public demo serves news data to bots behind a paywall using the L402 protocol: a programmatic client receives an HTTP 402 Payment Required response listing payment offers, pays a small amount through PayPal, receives a Bearer token, and fetches the content. Access to one category costs one cent; all categories cost five cents.",
      "Second place, Codebusters, modernized a PayPal integration for Shopware 6, moving from the old JavaScript SDK v5 to the beta v6 with stated benefits in maintainability and alignment with current PayPal standards.",
      "Third place, Rosen, is a social trading app powered by PYUSD where users tip and reward each other inside the app, with AI providing real-time multilingual translation. The team placed second in the Google x PayPal PYUSD Global Hackathon and claims tens of thousands of users.",
    ],
  },
  {
    slug: "l402-machine-payments",
    title: "L402 and the return of pay-per-request",
    dek: "Why agents are reviving a 1990s protocol for machine-to-machine payments.",
    premium: false,
    price: "0",
    currency: "USD",
    published: "2025-11-09",
    body: [
      "The HTTP 402 Payment Required status code has existed since the early web and was never widely deployed. Agentic commerce is changing that: when a program, not a person, fetches a resource, the server can answer 402 with a machine-readable list of payment options instead of HTML.",
      "The emerging L402 pattern pairs the 402 response with a payment credential flow: the client pays through a wallet or payment provider, the server issues a token, and subsequent requests carry that token as a Bearer credential. Content that costs a fraction of a cent becomes economically viable to meter.",
      "PayPal's hackathon projects show two sides of the same idea: CrawlerPal gates content for crawlers, while Standing Promise-style systems gate outcomes — a payer commits an amount only when a verifiable condition holds, and a pure function decides whether the money moves.",
    ],
  },
  {
    slug: "agentic-checkout-sandbox",
    title: "What it takes to let an agent check out for you",
    dek: "Approval flows, idempotency keys, and why the verdict must stay deterministic.",
    premium: false,
    price: "0",
    currency: "USD",
    published: "2025-11-09",
    body: [
      "Letting a language model click 'pay' is the wrong shape. The safer pattern splits the job: the model gathers evidence and proposes actions, while a deterministic function — fed only frozen snapshots — decides the consequence.",
      "In practice that means three disciplines. First, money stays integer minor units end to end. Second, every state transition writes an append-only event before it returns, so a crash never makes the log lie. Third, capture is idempotent on promise and attempt, so a double click or a retry can never charge twice.",
      "The demo value is in the visible middle: a payer approves a sandbox order on a live browser, a resolver freezes what the page said, and the verdict's own consequence — capture, release, or wait — is executed by the route, never chosen by the model.",
    ],
  },
  {
    slug: "micropayment-economics-agents",
    title: "The unit economics of agent micropayments",
    dek: "One-cent content, five-cent bundles, and where the margin actually lives.",
    premium: true,
    price: "0.01",
    currency: "USD",
    published: "2025-11-10",
    body: [
      "CrawlerPal's pricing — one cent per category, five cents for everything — looks trivial until you count requests. A research agent that reads twenty articles per task spends twenty cents; a fleet of agents spends dollars per hour. The interesting question is not the price but the verification cost: who pays to check that the content was actually delivered?",
      "Standing Promise inverts the usual escrow shape. Instead of locking funds and adjudicating later, the payer pre-commits an amount with a machine-checkable condition — the page contains a needle, the price is at most a ceiling — and capture happens only if the frozen evidence satisfies it. Release is the default when the world cannot be seen.",
      "The economics favor bundling at the protocol layer. Per-request fees below a cent are dominated by payment processing overhead, which is why L402-style systems tend to sell tokens or bundles rather than raw per-call charges. The agent pays once, caches the credential, and the publisher meters by token expiry rather than per request.",
      "For publishers, the paywall's real product is not the article but the signal: a crawler that pays is a crawler that intends to use the content, which is a far better monetization signal than an ad impression or a blocked bot.",
    ],
  },
  {
    slug: "verifiable-agent-spending",
    title: "Verifiable agent spending: receipts an auditor can replay",
    dek: "Append-only events, frozen snapshots, and verdicts that carry their own consequence.",
    premium: true,
    price: "0.01",
    currency: "USD",
    published: "2025-11-10",
    body: [
      "An agent that spends money needs an audit trail a skeptic can replay. The strongest version is boring: every promise writes created, verdict, snapshot and capture events in order; the verdict event stores both the decision and its full input; a replay route recomputes the identical answer without calling any vendor.",
      "Determinism is the feature, not a limitation. Because the verdict function reads no clock, no network and no randomness — time and evidence arrive as arguments — two runs over the same stored input produce byte-identical output. That turns 'trust the agent' into 'diff the replay.'",
      "The failure modes matter more than the happy path. A vendor that cannot be reached yields an unavailable fact, which maps to WAIT — never release, never capture. A duplicated settle request returns the first result and writes nothing. A capture claim is won in the database before PayPal is ever called, so concurrent settlers cannot double-charge.",
      "This is the shape agentic commerce needs to leave the demo stage: payment rails where the model proposes, the snapshot freezes, the function decides, and the event log proves what happened — in that order, every time.",
    ],
  },
];

export const articleBySlug = (slug: string): NewsArticle | undefined => ARTICLES.find((a) => a.slug === slug);

/** Pure. The 402 offer body (CrawlerPal-style) for a premium article. */
export function paywallOffer(a: NewsArticle) {
  return {
    error: "payment_required",
    article: a.slug,
    title: a.title,
    offers: [{ price: a.price, currency: a.currency, scheme: "standing-promise", amount: "Pay $0.01 only if the article is readable" }],
  };
}
