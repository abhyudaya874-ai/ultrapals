import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare for shared-secret headers. Different lengths are simply unequal. */
export const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
