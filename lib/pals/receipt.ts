import { createHash } from "node:crypto";
import type { SituationCard } from "./situation";

/** Canonical JSON: object keys sorted recursively, so the same data always hashes the same. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The part of a card the receipt covers: everything except the Case Desk stages that are computed from it. */
export const coreOf = (c: SituationCard): Omit<SituationCard, "rubric" | "blind" | "receipt"> => {
  const { rubric: _r, blind: _b, receipt: _x, ...core } = c;
  return core;
};
export const cardHash = (c: SituationCard): string => sha256(canon(coreOf(c)));
/** The receipt id covers the evidence hash, the rubric and the blind result: edit any of them and the id changes. */
export const receiptId = (c: SituationCard): string => sha256(canon({ cardHash: cardHash(c), rubric: c.rubric, blind: c.blind ?? null }));
