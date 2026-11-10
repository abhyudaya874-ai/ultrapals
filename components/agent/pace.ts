import type { CEvent } from "@/lib/computer/events";

/** How long the UI waits after showing an event before it shows the next one. Streams of text already arrive in pieces, so they get none. */
const BASE: Partial<Record<CEvent["kind"], number>> = {
  file: 420,
  visit: 150,
  step: 70,
  agent: 170,
  message: 220,
  spawn: 90,
  ladder: 300,
  situation: 300,
  sources: 220,
};

/** Pure. The pause after `e` given how many events are still waiting. A long backlog speeds up, so the display never falls minutes behind. */
export function paceDelay(e: CEvent, backlog: number): number {
  const base = BASE[e.kind] ?? 0;
  if (base === 0) return 0;
  const scale = backlog <= 6 ? 1 : backlog <= 16 ? 0.5 : backlog <= 40 ? 0.2 : 0;
  return Math.round(base * scale);
}

export const CHUNK_CHARS = 28;
export const CHUNK_MS = 14;

/**
 * Pure. A big block of answer text (a model that sent its whole reply at once) is cut into small pieces on word boundaries, so it still
 * appears as a stream. Short deltas and every other event pass through unchanged.
 */
export function expandEvent(e: CEvent): CEvent[] {
  if (e.kind !== "answer" || e.delta.length <= CHUNK_CHARS * 2) return [e];
  const out: CEvent[] = [];
  let rest = e.delta;
  while (rest.length > CHUNK_CHARS * 1.5) {
    const cut = rest.lastIndexOf(" ", CHUNK_CHARS);
    const at = cut > CHUNK_CHARS / 3 ? cut + 1 : CHUNK_CHARS;
    out.push({ kind: "answer", delta: rest.slice(0, at) });
    rest = rest.slice(at);
  }
  if (rest) out.push({ kind: "answer", delta: rest });
  return out;
}

/** Pure. Delay after a piece produced by `expandEvent`: answer pieces are spaced tightly, and only when they came from a split. */
export const chunkDelay = (e: CEvent, wasSplit: boolean): number => (e.kind === "answer" && wasSplit ? CHUNK_MS : 0);
