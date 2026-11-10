/** One row of a rendered diff. `a` is the line number in the old text, `b` in the new text. A `gap` row stands for unchanged lines left out. */
export interface DiffLine {
  op: "ctx" | "add" | "del" | "gap";
  text: string;
  a?: number;
  b?: number;
}
export interface Patch {
  lines: DiffLine[];
  adds: number;
  removes: number;
  /** Rows dropped because the patch was longer than `maxLines`. */
  cut: number;
}

const split = (t: string): string[] => (t === "" ? [] : t.replace(/\n$/, "").split("\n")); // a final newline ends the last line, it does not start another
const LCS_CELLS = 4_000_000;

/**
 * Pure. A line diff (common prefix and suffix first, then LCS on the middle) rendered as rows with `context` unchanged lines around each
 * change. Counts match `lineDiffStats`. Beyond ~4M cells the middle is shown as one block of removals then additions: still true, just coarser.
 */
export function diffLines(oldText: string, newText: string, o: { context?: number; maxLines?: number } = {}): Patch {
  const context = Math.max(0, o.context ?? 3);
  const maxLines = Math.max(10, o.maxLines ?? 400);
  const A = split(oldText);
  const B = split(newText);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf);
  const b = B.slice(pre, B.length - suf);

  const mid: DiffLine[] = [];
  if (a.length * b.length > LCS_CELLS) {
    a.forEach((t, i) => mid.push({ op: "del", text: t, a: pre + i + 1 }));
    b.forEach((t, j) => mid.push({ op: "add", text: t, b: pre + j + 1 }));
  } else {
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        mid.push({ op: "ctx", text: a[i], a: pre + i + 1, b: pre + j + 1 });
        i++;
        j++;
      } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) {
        mid.push({ op: "del", text: a[i], a: pre + i + 1 }); // removals first, as every diff tool shows them
        i++;
      } else {
        mid.push({ op: "add", text: b[j], b: pre + j + 1 });
        j++;
      }
    }
  }

  const all: DiffLine[] = [
    ...A.slice(0, pre).map((t, k): DiffLine => ({ op: "ctx", text: t, a: k + 1, b: k + 1 })),
    ...mid,
    ...A.slice(A.length - suf).map((t, k): DiffLine => ({ op: "ctx", text: t, a: A.length - suf + k + 1, b: B.length - suf + k + 1 })),
  ];
  const adds = all.filter((l) => l.op === "add").length;
  const removes = all.filter((l) => l.op === "del").length;

  // keep only the lines within `context` of a change; a run of dropped lines becomes one gap row
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((l, k) => {
    if (l.op === "ctx") return;
    for (let x = Math.max(0, k - context); x <= Math.min(all.length - 1, k + context); x++) keep[x] = true;
  });
  const rows: DiffLine[] = [];
  let skipped = 0;
  all.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) rows.push({ op: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
      skipped = 0;
      rows.push(l);
    } else skipped++;
  });
  if (skipped && rows.length) rows.push({ op: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  if (rows.length > maxLines) return { lines: rows.slice(0, maxLines), adds, removes, cut: rows.length - maxLines };
  return { lines: rows, adds, removes, cut: 0 };
}

/** Pure. The first `max` lines of a file as numbered context rows: what "read a file" shows. `cut` is how many lines were left out. */
export function readRows(text: string, max = 80): { lines: DiffLine[]; total: number; cut: number } {
  const all = split(text);
  return { lines: all.slice(0, max).map((t, k): DiffLine => ({ op: "ctx", text: t, b: k + 1 })), total: all.length, cut: Math.max(0, all.length - max) };
}
