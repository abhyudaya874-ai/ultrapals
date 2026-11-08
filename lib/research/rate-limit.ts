const hits = new Map<string, number[]>();

/**
 * Pure apart from the module-level map. Sliding window per key: `limit` calls per `windowMs`.
 * The free tiers behind /api/agent (Groq 1K req/day, Tavily/Exa credits) are shared, so one tab cannot be allowed to drain them.
 */
export function allow(key: string, nowMs: number, limit = 8, windowMs = 60_000): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  hits.set(key, [...recent, nowMs]);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}
