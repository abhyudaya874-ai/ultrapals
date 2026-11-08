/** "412ms" · "1.2s" · "21m 40s" · "1h 3m". UI-only durations. Never use these for money. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}.${Math.floor((ms % 1000) / 100)}s`;
  const m = Math.floor(totalSec / 60);
  if (m < 60) return `${m}m ${totalSec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
