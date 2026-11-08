import { formatMajor } from "@/lib/money";
import type { Condition } from "@/lib/verdict";

/** The second half of the terms bubble sentence: what the payer is waiting for in the world. */
export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case "none":
      return "Capture as soon as the payer approves.";
    case "price_at_most":
      return `...and "${c.query}" costs ${formatMajor(c.ceilingMinor, c.currency)} ${c.currency} or less.`;
    case "page_contains":
      return `...and ${c.url} contains "${c.needle}".`;
  }
}
