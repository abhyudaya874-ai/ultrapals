/** A short id for one run (used in idempotency keys). Not a secret and not used for anything security-relevant. */
export const generateId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
