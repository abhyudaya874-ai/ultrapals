/** Browsers allow only about 16 live WebGL contexts, so only a few orbs may use one at a time; the rest show the still face (same eyes, no GPU). */
export function createBudget(max: number) {
  let used = 0;
  return {
    /** Takes a slot if one is free. */
    acquire(): boolean {
      if (used >= max) return false;
      used++;
      return true;
    },
    release(): void {
      used = Math.max(0, used - 1);
    },
    get used(): number {
      return used;
    },
  };
}
export const MAX_LIVE_ORBS = 8;
export const gpuBudget = createBudget(MAX_LIVE_ORBS);
