/**
 * Shows items one at a time with a pause after each, in the order they arrived. The pause can depend on how many are still waiting, so a long
 * backlog speeds up. Batches can be pushed at any time, including while an earlier batch is still being shown.
 *
 * Whether a run of the pump is active is a flag set before anything is shown and cleared when the queue is empty. (Tracking it with the promise a
 * run returns does not work: a batch that needs no pauses finishes before that promise is even assigned, and the stale promise then blocks every
 * later batch from being shown.)
 */
export interface Pump<T> {
  push: (items: readonly T[]) => void;
  /** Resolves when everything pushed so far has been shown. Rejects if `show` threw. */
  idle: () => Promise<void>;
  /** From now on nothing waits: what is left is shown at once. */
  hurry: () => void;
}

export function createPump<T>(show: (item: T) => void, delay: (item: T, waiting: number) => number, sleep: (ms: number) => Promise<void>): Pump<T> {
  const queue: T[] = [];
  let pumping = false;
  let fast = false;
  let current: Promise<void> = Promise.resolve();
  const run = async (): Promise<void> => {
    pumping = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift() as T;
        show(item);
        const ms = fast ? 0 : delay(item, queue.length);
        if (ms > 0) await sleep(ms);
      }
    } finally {
      pumping = false;
    }
  };
  return {
    push: (items) => {
      queue.push(...items);
      if (!pumping) current = run();
    },
    idle: () => current,
    hurry: () => { fast = true; },
  };
}
