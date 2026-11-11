/** A promise as the sidebar's list gets it from /api/promises/recent. (The list itself, with chats, battles, loops and automations, is history.ts.) */
export interface Item {
  id: string;
  title: string;
  state: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}

const STATE_LABEL: Record<string, string> = { open: "Waiting", capture_pending: "Capturing", captured: "Paid", declined: "Declined", released: "Released" };
/** Pure. A promise state in words. A state it does not know is shown as it is. */
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? s;
