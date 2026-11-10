import type { CEvent } from "./events";

/**
 * Runs `run` and streams every event it emits WHILE it is still awaiting, instead of after. Needed where a library function awaits a
 * model or a search for many seconds: without this the UI sees nothing until the whole thing returns.
 */
export async function* pump<T>(run: (emit: (e: CEvent) => void) => Promise<T>): AsyncGenerator<CEvent, T> {
  const queue: CEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let value: T | undefined;
  let failure: unknown;
  let failed = false;
  const ping = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  void run((e) => {
    queue.push(e);
    ping();
  }).then(
    (v) => { value = v; done = true; ping(); },
    (e) => { failure = e; failed = true; done = true; ping(); },
  );
  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (done) break;
    await new Promise<void>((r) => { wake = r; if (queue.length || done) ping(); });
  }
  if (failed) throw failure;
  return value as T;
}
