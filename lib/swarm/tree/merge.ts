export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs generator tasks `n` at a time and streams their events AS THEY ARRIVE (a plain concurrency limiter would hide them
 * until the end). Results come back in INPUT order. A task that throws becomes {ok:false}; the others finish.
 * A consumer that stops early stops the tasks from pulling more.
 */
export async function* mergeStreams<E, R>(tasks: (() => AsyncGenerator<E, R>)[], n: number): AsyncGenerator<E, Settled<R>[]> {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("mergeStreams: n must be an integer >= 1");
  const results: Settled<R>[] = new Array(tasks.length);
  const queue: E[] = [];
  let wake: (() => void) | null = null;
  let next = 0;
  let live = 0;
  let done = 0;
  let stopped = false;
  const ping = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const start = (): void => {
    while (!stopped && live < n && next < tasks.length) {
      const i = next++;
      live++;
      void (async () => {
        const g = tasks[i]();
        try {
          for (;;) {
            const r = await g.next();
            if (r.done) {
              results[i] = { ok: true, value: r.value };
              break;
            }
            queue.push(r.value);
            ping();
            if (stopped) {
              await g.return(undefined as never);
              results[i] = { ok: false, error: "cancelled" };
              break;
            }
          }
        } catch (e) {
          results[i] = { ok: false, error: e instanceof Error ? e.message : String(e) };
        } finally {
          live--;
          done++;
          start();
          ping();
        }
      })();
    }
  };

  try {
    start();
    while (done < tasks.length) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((r) => {
        wake = r;
        if (queue.length || done >= tasks.length) ping();
      });
    }
    while (queue.length) yield queue.shift()!;
    return results;
  } finally {
    stopped = true;
  }
}
