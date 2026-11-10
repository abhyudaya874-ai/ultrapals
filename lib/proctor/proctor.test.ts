import { beforeEach, describe, expect, it } from "vitest";
import type { ProbeRow } from "@/lib/pals/probe";
import { allowEscalation, changed, diffRows, dueJobs, escalationStep, fingerprint, type Schedule } from "./core";
import { runDue, type ProctorDeps } from "./run";
import { proctorStore } from "./store";

const S: Schedule = { job: "sandbox_canary", everyMs: 60_000, dailyCases: 2 };
const rows = (o: ProbeRow["outcome"] = "pass"): ProbeRow[] => [{ rail: "stripe", check: "typed_error", outcome: o, detail: `d${Math.random()}` }, { rail: "square", check: "typed_error", outcome: "pass", detail: "x" }];

describe("pure core", () => {
  it("T28 dueJobs: never-run is due; elapsed interval is due; not yet is not", () => {
    expect(dueJobs([S], {}, 1000)).toEqual(["sandbox_canary"]);
    expect(dueJobs([S], { sandbox_canary: 0 }, 59_999)).toEqual([]);
    expect(dueJobs([S], { sandbox_canary: 0 }, 60_000)).toEqual(["sandbox_canary"]);
  });
  it("T29 the first run is a baseline, not a change", () => {
    expect(changed(null, "a")).toBe("baseline");
    expect(changed("a", "a")).toBe("same");
    expect(changed("a", "b")).toBe("changed");
  });
  it("T32 allowEscalation: budget, quiet hours (also wrapping midnight)", () => {
    expect(allowEscalation(S, 2, 12)).toEqual({ ok: false, why: "budget" });
    expect(allowEscalation({ ...S, quiet: { fromHour: 22, toHour: 6 } }, 0, 23)).toEqual({ ok: false, why: "quiet" });
    expect(allowEscalation({ ...S, quiet: { fromHour: 22, toHour: 6 } }, 0, 3)).toEqual({ ok: false, why: "quiet" });
    expect(allowEscalation({ ...S, quiet: { fromHour: 22, toHour: 6 } }, 0, 12)).toEqual({ ok: true });
  });
  it("T31 the ladder never skips the re-check", () => {
    expect(escalationStep("none", "confirmed")).toBe("recheck");
    expect(escalationStep("none", null)).toBe("recheck");
    expect(escalationStep("rechecked", "confirmed")).toBe("open_case");
    expect(escalationStep("rechecked", "flaked")).toBe("stop");
    expect(escalationStep("rechecked", null)).toBe("stop");
  });
  it("fingerprint ignores details (ids change every run) but not outcomes", () => {
    expect(fingerprint(rows())).toBe(fingerprint(rows()));
    expect(fingerprint(rows())).not.toBe(fingerprint(rows("fail")));
  });
  it("diffRows names the flipped checks and the ones that vanished", () => {
    expect(diffRows(rows(), rows("fail"))).toEqual([{ rail: "stripe", check: "typed_error", from: "pass", to: "fail" }]);
    expect(diffRows(rows(), rows().slice(0, 1))).toEqual([{ rail: "square", check: "typed_error", from: "pass", to: "absent" }]);
  });
});

describe("runDue", () => {
  let t = 1_700_000_000_000;
  let queue: (ProbeRow[] | "off" | "error")[] = [];
  let n = 0;
  let calls = 0;
  const reply = async () => {
    calls++;
    const nxt = queue.length > 1 ? queue.shift()! : queue[0];
    return nxt === "off" ? { ok: false as const, degraded: true as const, reason: "stripe off" } : nxt === "error" ? { ok: false as const, degraded: true as const, reason: "stripe: http 500" } : { ok: true as const, data: nxt };
  };
  const deps = (): ProctorDeps => ({ probes: { stripe: reply, square: async () => ({ ok: true, data: [{ rail: "square", check: "typed_error", outcome: "pass", detail: "x" }] }), paypal: async () => ({ ok: true, data: [] }) }, now: () => t, id: () => `id${n++}` });
  beforeEach(() => { proctorStore.reset(); t = 1_700_000_000_000; queue = []; n = 0; calls = 0; });
  const S1 = [S];

  it("first run baselines; an identical second run stops with zero further work (T30-style)", async () => {
    queue = [rows()];
    expect((await runDue(deps(), S1))[0].status).toBe("baseline");
    t += 60_000;
    calls = 0;
    const r = await runDue(deps(), S1);
    expect(r[0].status).toBe("unchanged");
    expect(calls).toBe(1); // one canary pass, no re-check, no case
    expect(proctorStore.get().cases).toEqual([]);
  });
  it("a change is re-checked once; a change that stays opens exactly one case with the diff", async () => {
    queue = [rows(), rows("fail"), rows("fail")];
    await runDue(deps(), S1);
    t += 60_000;
    const r = await runDue(deps(), S1);
    expect(r[0].status).toBe("case_opened");
    expect(proctorStore.get().cases).toHaveLength(1);
    expect(proctorStore.get().cases[0].changes).toEqual([{ rail: "stripe", check: "typed_error", from: "pass", to: "fail" }]);
  });
  it("a change that reverts on the re-check is a flake: no case", async () => {
    queue = [rows(), rows("fail"), rows()];
    await runDue(deps(), S1);
    t += 60_000;
    expect((await runDue(deps(), S1))[0].status).toBe("flaked");
    expect(proctorStore.get().cases).toEqual([]);
  });
  it("T33 a check that cannot run is MISSED, never 'no change', and the baseline is untouched", async () => {
    queue = [rows()];
    await runDue(deps(), S1);
    const base = proctorStore.get().last.sandbox_canary!.fingerprint;
    queue = ["error"];
    t += 60_000;
    expect((await runDue(deps(), S1))[0].status).toBe("missed");
    expect(proctorStore.get().last.sandbox_canary!.fingerprint).toBe(base);
  });
  it("an adapter that is switched off is absent, not a missed run", async () => {
    queue = ["off"];
    const r = await runDue(deps(), S1);
    expect(r[0].status).toBe("baseline"); // square + paypal rows only
  });
  it("T32 the daily case budget holds: a second confirmed change that day is kept for later, not opened", async () => {
    const one: Schedule = { ...S, dailyCases: 1 };
    queue = [rows(), rows("fail"), rows("fail")];
    await runDue(deps(), [one]);
    t += 60_000;
    expect((await runDue(deps(), [one]))[0].status).toBe("case_opened");
    queue = [rows(), rows()]; // back to pass, and it stays: a confirmed change, but the budget is spent
    t += 60_000;
    expect((await runDue(deps(), [one]))[0].status).toBe("changed_unreported");
    expect(proctorStore.get().cases).toHaveLength(1);
  });
  it("T34 firing the same job twice at once gives one logical result", async () => {
    queue = [rows()];
    const [a, b] = await Promise.all([runDue(deps(), S1), runDue(deps(), S1)]);
    expect(a.length + b.length).toBe(1);
  });
  it("T35 no Proctor code reaches PayPal writes, the DB or a verdict", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL("./", import.meta.url).pathname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(dir + f, "utf8");
      expect(src, f).not.toMatch(/from "@\/(db|lib\/paypal|lib\/capture)|computeVerdict|process\.env/);
    }
  });
});
