/** Files the agents made, kept in this browser (localStorage) so the Artifacts page still has them after a reload. Nothing here is sent anywhere. */
export interface StoredFile {
  path: string;
  content: string;
  at: number;
  source: "chat" | "automation";
  /** The automation's name, when it came from one. */
  from?: string;
}
export const STORE_KEY = "sp-artifacts";
export const MAX_STORED_BYTES = 1_200_000;
export const MAX_STORED_FILES = 60;

/** Pure. Reads what was stored without trusting it: junk entries are dropped, the rest is newest-first. */
export function parseStored(raw: string | null): StoredFile[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is StoredFile => !!x && typeof x === "object" && typeof (x as StoredFile).path === "string" && typeof (x as StoredFile).content === "string" && typeof (x as StoredFile).at === "number" && ((x as StoredFile).source === "chat" || (x as StoredFile).source === "automation"))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Pure. Adds or replaces files by path (and source), newest first, and drops the oldest until the count and size caps hold. */
export function mergeStored(prev: readonly StoredFile[], add: readonly StoredFile[]): StoredFile[] {
  const key = (f: StoredFile) => `${f.source}|${f.from ?? ""}|${f.path}`;
  const map = new Map(prev.map((f) => [key(f), f]));
  for (const f of add) {
    const cur = map.get(key(f));
    if (!cur || f.at >= cur.at) map.set(key(f), f);
  }
  const all = [...map.values()].sort((a, b) => b.at - a.at).slice(0, MAX_STORED_FILES);
  let size = all.reduce((n, f) => n + f.content.length, 0);
  while (size > MAX_STORED_BYTES && all.length > 1) size -= all.pop()!.content.length;
  return all;
}

/** Pure. Groups newest-first files under "November 2026" style headings, in order. */
export function byMonth(files: readonly StoredFile[]): { month: string; files: StoredFile[] }[] {
  const out: { month: string; files: StoredFile[] }[] = [];
  for (const f of files) {
    const month = new Date(f.at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const last = out.at(-1);
    if (last?.month === month) last.files.push(f);
    else out.push({ month, files: [f] });
  }
  return out;
}
