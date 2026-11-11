import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KEEP_RUNS, MAX_AUTOMATIONS, Spec, canStart, heavyRoom, newAutomation, scheduleNext, type Automation, type RunSummary } from "./core";
import { MAX_HEAVY_ON } from "./kinds";

export interface StoreIO {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}
/** The words for refusing a third Battle or Loop to be switched on. */
export const heavyReason = (): string => `at most ${MAX_HEAVY_ON} Battle or Loop automations can be on at once (each run opens a cloud computer per team); pause one first`;
export type Claim = { ok: true; automation: Automation } | { ok: false; why: string };

const RUN_FIELDS = (r: unknown): r is RunSummary => !!r && typeof r === "object" && typeof (r as RunSummary).id === "string" && typeof (r as RunSummary).atMs === "number" && Array.isArray((r as RunSummary).files);

/** Pure. Reads the file without trusting it: an entry that is not a valid automation is dropped, the rest survive. */
export function parseDb(text: string | null): Automation[] {
  if (!text) return [];
  try {
    const j: unknown = JSON.parse(text);
    const list = (j as { automations?: unknown })?.automations;
    if (!Array.isArray(list)) return [];
    return list.flatMap((x): Automation[] => {
      const spec = Spec.safeParse(x);
      const o = x as Partial<Automation>;
      if (!spec.success || typeof o.id !== "string" || typeof o.createdAtMs !== "number") return [];
      return [{ ...spec.data, id: o.id, createdAtMs: o.createdAtMs, nextRunMs: typeof o.nextRunMs === "number" ? o.nextRunMs : null, lastRunMs: typeof o.lastRunMs === "number" ? o.lastRunMs : undefined, runningSince: typeof o.runningSince === "number" ? o.runningSince : undefined, runLog: Array.isArray(o.runLog) ? o.runLog.filter((t): t is number => typeof t === "number").slice(-60) : [], runs: Array.isArray(o.runs) ? o.runs.filter(RUN_FIELDS).slice(0, KEEP_RUNS) : [] }];
    });
  } catch {
    return [];
  }
}

/**
 * Automations kept in one JSON file. Every operation re-reads the file and writes it back whole (temp file + rename), one at a time inside this
 * process, so two server processes on the same folder do not trample each other's data. It is not a database: on a host with a throwaway disk
 * (a free Render web service) it is lost on redeploy. A table needs a migration of the protected schema, which is a separate decision.
 */
export function createStore(io: StoreIO, genId: () => string) {
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const load = async () => parseDb(await io.read());
  const save = (list: Automation[]) => io.write(JSON.stringify({ automations: list }));
  const mutate = <T>(f: (list: Automation[]) => { list: Automation[]; out: T }): Promise<T> =>
    exclusive(async () => {
      const { list, out } = f(await load());
      await save(list);
      return out;
    });
  const one = (list: Automation[], id: string) => list.find((a) => a.id === id);

  return {
    list: (): Promise<Automation[]> => exclusive(load),
    get: (id: string): Promise<Automation | undefined> => exclusive(async () => one(await load(), id)),
    create: (spec: Spec, now: number): Promise<{ ok: true; automation: Automation } | { ok: false; reason: string }> =>
      mutate<{ ok: true; automation: Automation } | { ok: false; reason: string }>((list) => {
        if (list.length >= MAX_AUTOMATIONS) return { list, out: { ok: false as const, reason: `at most ${MAX_AUTOMATIONS} automations; delete one first` } };
        if (!heavyRoom(list, spec)) return { list, out: { ok: false as const, reason: heavyReason() } };
        const a = newAutomation(spec, genId(), now);
        return { list: [...list, a], out: { ok: true as const, automation: a } };
      }),
    update: (id: string, patch: Partial<Spec>, now: number): Promise<Automation | null> =>
      mutate((list) => {
        const cur = one(list, id);
        if (!cur) return { list, out: null };
        const merged = Spec.safeParse({ ...cur, ...patch });
        if (!merged.success || !heavyRoom(list, merged.data, id)) return { list, out: null };
        const next: Automation = { ...cur, ...merged.data };
        next.nextRunMs = next.enabled ? (patch.schedule || patch.tzOffsetMin !== undefined || !cur.enabled ? scheduleNext(next, now) : cur.nextRunMs) : null;
        return { list: list.map((a) => (a.id === id ? next : a)), out: next };
      }),
    remove: (id: string): Promise<boolean> => mutate((list) => ({ list: list.filter((a) => a.id !== id), out: list.some((a) => a.id === id) })),
    /** Marks the automation as running if it may start; the caller must call `finish`. */
    claim: (id: string, now: number): Promise<Claim> =>
      mutate<Claim>((list) => {
        const cur = one(list, id);
        if (!cur) return { list, out: { ok: false as const, why: "no such automation" } };
        const c = canStart(cur, now);
        if (!c.ok) return { list, out: c };
        const next: Automation = { ...cur, runningSince: now, runLog: [...cur.runLog, now].slice(-60) };
        return { list: list.map((a) => (a.id === id ? next : a)), out: { ok: true as const, automation: next } };
      }),
    finish: (id: string, run: RunSummary, now: number): Promise<Automation | null> =>
      mutate((list) => {
        const cur = one(list, id);
        if (!cur) return { list, out: null };
        const next: Automation = { ...cur, runningSince: undefined, lastRunMs: now, runs: [run, ...cur.runs].slice(0, KEEP_RUNS), nextRunMs: cur.enabled ? scheduleNext(cur, now) : null };
        return { list: list.map((a) => (a.id === id ? next : a)), out: next };
      }),
  };
}

const file = () => join(process.cwd(), ".data", "automations.json");
const fsIO: StoreIO = {
  read: () => readFile(file(), "utf8").catch(() => null),
  write: async (text) => {
    await mkdir(dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, file());
  },
};

const g = globalThis as unknown as { __automationStore?: ReturnType<typeof createStore> };
/** One store per process (it survives dev hot reloads). */
export const automationStore = (): ReturnType<typeof createStore> => (g.__automationStore ??= createStore(fsIO, () => crypto.randomUUID()));
