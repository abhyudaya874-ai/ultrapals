import type { Snapshot } from "./snapshot";

/**
 * Pages a browsing agent must not try to get past by itself. A CAPTCHA, a "verify you are human" check or a block page is a wall that exists to
 * stop programs: the agent stops, tells the person exactly what to do in the live browser, and carries on when they say so.
 * Sign-in forms and verification codes are different: whether they matter depends on the task, so they are only pointed out to the model,
 * which can ask for help with the `handoff` action.
 */
export type NeedKind = "captcha" | "login" | "verification";
export interface HumanNeed {
  kind: NeedKind;
  /** What the person has to do, in one sentence. */
  reason: string;
  /** True when the agent must stop at once (a CAPTCHA); false when it is only a hint for the model. */
  stop: boolean;
}

/** Pure. Whether the address is itself a challenge page: a known challenge host, or a challenge path at the root of a site (not "/wiki/CAPTCHA"). */
function wallUrl(u: string): boolean {
  try {
    const { hostname: h, pathname: p } = new URL(u);
    if (/(^|\.)(hcaptcha\.com|arkoselabs\.com|funcaptcha\.com)$/i.test(h)) return true;
    if (/(^|\.)google\.com$/i.test(h) && /^\/(sorry\/|recaptcha\/)/i.test(p)) return true;
    return /^\/(captcha|recaptcha|challenge|are-you-human|human-verification|distil_r_captcha|_incapsula_)(\/|$)/i.test(p) || /^\/cdn-cgi\/(challenge-platform|l\/chk_)/i.test(p);
  } catch {
    return false;
  }
}
// phrases that appear on a challenge page and almost nowhere else
const TEXT_WALL = [
  /unusual traffic from your computer network/i,
  /our systems have detected unusual traffic/i,
  /verify (?:that )?you(?:'| a)?re (?:a )?human/i,
  /verify you are (?:a )?human/i,
  /(?:i'?m|i am) not a robot/i,
  /are you a (?:robot|human)\b/i,
  /checking (?:if the site connection is secure|your browser before accessing)/i,
  /complete the security check to (?:access|continue)/i,
  /press (?:&|and) hold/i,
  /confirm you are (?:a )?human/i,
  /please (?:solve|complete) (?:the|this) (?:captcha|puzzle|challenge)/i,
  /performing security verification/i,
  /enable javascript and cookies to continue/i,
];
const TITLE_WALL = /^(?:just a moment\.{0,3}|attention required!?(?: \| cloudflare)?|access denied|are you a robot\??|security check|human verification|one more step)$/i;
// a real article about CAPTCHAs is long; a challenge page is a few lines
const SHORT = 2500;

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "this site";
  }
};

/** Pure. Whether the page in front of the agent needs a person. A password field or a verification-code prompt is a hint; a CAPTCHA is a stop. */
export function needsHuman(s: Pick<Snapshot, "url" | "title" | "text" | "elements">): HumanNeed | null {
  const short = s.text.length <= SHORT;
  const wallByUrl = wallUrl(s.url);
  const wallByTitle = TITLE_WALL.test(s.title.trim());
  const wallByText = short && TEXT_WALL.some((r) => r.test(s.text));
  if (wallByUrl || ((wallByTitle || wallByText) && short)) {
    return { kind: "captcha", stop: true, reason: `${hostOf(s.url)} is showing a security check (a CAPTCHA). Solve it in the browser.` };
  }
  if (s.elements.some((e) => e.type === "password")) {
    return { kind: "login", stop: false, reason: `${hostOf(s.url)} is asking you to sign in.` };
  }
  if (short && /\b(?:enter|type) the (?:\d[- ]?digit |verification |security |one-time )?code\b|two-factor|2-step verification|verify your identity|we(?:'ve)? sent (?:you )?a (?:\d[- ]?digit |verification |security )?code/i.test(s.text)) {
    return { kind: "verification", stop: false, reason: `${hostOf(s.url)} is asking for a verification code.` };
  }
  return null;
}

/** What the planner is told when a page only hints at a person being needed. */
export const noticeFor = (n: HumanNeed | null): string =>
  n && !n.stop
    ? `${n.reason} You have no credentials and must never type any. If the task needs the account, use the handoff action to ask the person to do it; if it does not, carry on without it.`
    : "";

/** A pause waiting for a person, kept on the conversation until they reply. */
export interface Handoff {
  agent: "browser";
  task: string;
  reason: string;
  kind: NeedKind | "asked";
  url: string;
  /** The last things the agent did, so the continuation does not start over. */
  notes: string[];
  /** What the agent had written down from the pages it read, so the facts survive the pause. */
  found?: string;
  /** Addresses of the pages the agent had been on, so the continuation does not go back to where it started. */
  visited?: string[];
  at: number;
}

/** Pure. An address reduced to where it is, ignoring the query, the fragment and a trailing slash: two addresses for the same page compare equal. */
export function sameSpot(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}
export const HANDOFF_TTL_MS = 30 * 60_000;

/** Pure. The pause if it is still fresh. */
export const freshHandoff = (h: Handoff | undefined, now: number): Handoff | null => (h && now - h.at <= HANDOFF_TTL_MS ? h : null);

// "continue", "go ahead", "resume", "done", "ok", "I solved it" ... at the start of a short message. Longest phrases first: the first one that fits wins.
const RESUME = new RegExp(
  "^\\s*(?:" +
    [
      "thank you", "thanks", "thx",
      "(?:i(?:'m| am| have|'ve)?\\s+)?(?:done|back|finished|ready|solved(?:\\s+(?:it|that))?|passed(?:\\s+(?:it|that))?|did(?:\\s+(?:it|that))?|completed(?:\\s+(?:it|that))?|logged\\s+in|signed\\s+in)",
      "it(?:'s| is| was)\\s+(?:done|solved|fine|ok(?:ay)?)",
      "all\\s+(?:set|done|good)",
      "go(?:\\s+ahead|\\s+on)?", "carry\\s+on", "keep\\s+(?:going|on)", "try\\s+again",
      "ok(?:ay)?", "k", "yes", "yep", "yeah", "yup", "sure", "continue", "resume", "proceed", "done", "finished", "solved", "passed", "ready", "retry",
    ].join("|") +
    ")\\b[\\s,.:;!\\-–—]*",
  "i",
);

/** Pure. Whether a message is the person saying "carry on" (in any of the usual ways), and anything else they added after it. */
export function parseResume(message: string): { resume: boolean; extra: string } {
  const m = RESUME.exec(message);
  if (!m || message.length > 240) return { resume: false, extra: "" };
  return { resume: true, extra: message.slice(m[0].length).trim() };
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Pure. Whether two requests for help say the same thing. A run that has just been helped must not ask for the same help again (that is a loop); a different request is fine. */
export function sameAsk(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  if (x.size === 0 || y.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/** Pure. The task the browser agent gets when the person says to continue: the original task, why it stopped, what it had done, and what they added. */
export function resumeTask(h: Handoff, extra: string): string {
  return [
    "CONTINUING AFTER A PAUSE.",
    `You stopped earlier because: ${h.reason}`,
    "The person has dealt with that in the live browser and asked you to continue. Do not ask for that help again; it has been given. Look at the page that is open NOW (they may have moved the browser) and carry on from there. Do not start over and do not repeat steps that are already done (they are listed under RECENT STEPS); open an address again only if the page you need is no longer open.",
    h.notes.length ? `Already done: ${h.notes.join("; ")}.` : "",
    h.found ? `What you had already written down (still true; use it in your answer):\n${h.found}` : "",
    extra ? `The person added: "${extra}"` : "",
    `THE ORIGINAL TASK, for what you are trying to achieve. Its first steps are done: carry on with what is left of it, not from its beginning: ${h.task}`,
  ].filter(Boolean).join("\n");
}

/** Pure. What UltraPal tells the person when the browser needs them. Written in code so it is the same every time. */
export function handoffMessage(h: Pick<Handoff, "reason" | "notes">): string {
  const done = h.notes.length ? `\n\nSo far: ${h.notes.slice(-3).join("; ")}.` : "";
  return `I need your help in the browser. ${h.reason}${done}\n\nThe browser is open and you are in control. When you are done, tell me to continue (any message works) and I will pick up from there.`;
}

/** Pure. A note for the planner when the person's reply is not a plain "continue": what was pending, so it can still choose to resume. */
export const pendingNote = (h: Handoff): string =>
  `The browser agent stopped earlier and is waiting on the person. Why: ${h.reason} Its task was: "${h.task}". The page was ${h.url || "unknown"}. The person has now replied. If the reply means they handled it or want to go on, delegate the same task to the browser again (it continues from the page that is open). If the reply changes the plan, follow the reply.`;
