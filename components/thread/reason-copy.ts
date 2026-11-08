import type { ReasonCode } from "@/lib/verdict";

/**
 * The thread's answer sentence when no live explanation exists (page reload: the trace is not persisted).
 * Record<ReasonCode, string> => a new reason code is a COMPILE ERROR until it has a sentence here.
 * Do NOT import FALLBACK from lib/agent/agents/explainer.ts: that file pulls server-only code into the client bundle.
 */
export const REASON_SENTENCE: Record<ReasonCode, string> = {
  AMOUNT_MET: "The approved amount meets the commitment, so the capture goes through.",
  AMOUNT_SHORT: "The window closed with less than the committed amount, so nothing is captured.",
  WINDOW_EXPIRED: "The window closed with no approval, so nothing is captured.",
  WINDOW_OPEN: "The window is still open, so the verdict is deferred.",
  FACT_MISSING: "The evidence could not be read, so nothing is decided or captured yet.",
  CURRENCY_MISMATCH: "A currency does not match the commitment, so nothing is captured.",
  CONDITION_MET: "The approved amount is in and the condition is true, so the capture goes through.",
  CONDITION_PENDING: "The payment is in but the condition is not true yet, so we are still waiting.",
  CONDITION_UNMET: "The window closed and the condition never came true, so nothing is captured.",
};
