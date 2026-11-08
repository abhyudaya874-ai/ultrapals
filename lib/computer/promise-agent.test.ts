import { beforeAll, describe, expect, it } from "vitest";
import { matchArticle, runPromiseAgent } from "./promise-agent";
import type { PromiseInfo } from "./promise-ops";
import { collect, mkDeps, mkSession, ok, scripted, VM } from "./fakes";

// getEnv() is lazy; give it a public base so the unlock path runs (localhost would degrade by design).
beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
  process.env.PAYPAL_CLIENT_ID ??= "x";
  process.env.PAYPAL_CLIENT_SECRET ??= "y";
  process.env.PAYPAL_ENV = "sandbox";
  process.env.PUBLIC_URL = "https://pub.example.com";
});

const SLUG = "micropayment-economics-agents";
const info = (state: string): PromiseInfo => ({
  id: "pid-1",
  title: 'Unlock "The unit economics of agent micropayments"',
  state,
  amountMinor: 1,
  currency: "USD",
  paypalOrderId: "ORDER1",
  condition: { kind: "page_contains", url: `https://pub.example.com/api/newsroom/proof?article=${SLUG}`, needle: `unlocked:${SLUG}` },
  windowEndsAt: new Date("2026-01-01T00:00:00Z"),
});

describe("matchArticle", () => {
  it("matches premium articles by slug, title and topic words", () => {
    expect(matchArticle(`unlock the premium story about ${SLUG}`)?.slug).toBe(SLUG);
    expect(matchArticle("read the story on verifiable agent spending")?.slug).toBe("verifiable-agent-spending");
    expect(matchArticle("what did dev days winners build")?.slug).toBe("dev-days-2025-winners");
    expect(matchArticle("Unlock the premium Newsroom article on agent micropayments and provide the unlocked URL and promise ID")?.slug).toBe(SLUG); // the exact delegation that failed live
    expect(matchArticle("what is the capital of france")).toBeNull();
    expect(matchArticle("tell me a joke")).toBeNull();
  });
});

describe("runPromiseAgent unlock flow", () => {
  it("creates, approves on the VM browser, settles and returns the unlock URL", async () => {
    let settled = false;
    const calls: string[] = [];
    const deps = mkDeps(scripted([]).open, {
      promise: {
        create: async (input) => {
          calls.push(`create:${input.condition?.kind}`);
          return ok({ promiseId: "pid-1" });
        },
        settle: async () => {
          settled = true;
          calls.push("settle");
          return ok(null);
        },
        info: async () => ok(info(settled ? "captured" : "open")),
        find: async () => ok([]),
      },
      approveOrder: async (vm, orderId) => {
        calls.push(`approve:${vm.id}:${orderId}`);
        return ok({ finalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1&ba_token=x" });
      },
      orderStatus: async () => ok({ status: "APPROVED" }),
    });
    const session = mkSession(); // vm preset: ensureVm returns it without opening
    const { ev, ret } = await collect(runPromiseAgent({ agent: "promise-1", session, deps }, `unlock the premium story about ${SLUG}`));

    expect(calls).toEqual([`create:page_contains`, "approve:vm-1:ORDER1", "settle"]);
    const states = ev.filter((e) => e.kind === "step").map((e) => (e as { state: string }).state);
    expect(states).toContain("ok");
    expect(states).not.toContain("error");
    expect(ret).toContain(`slug=${SLUG}&token=pid-1`);
    expect(ret).toContain("CAPTURED");
    expect(ev.some((e) => e.kind === "page" && (e as { url: string }).url.includes("paypal.com"))).toBe(true);
  });

  it("honestly reports a released settle instead of claiming unlock", async () => {
    const deps = mkDeps(scripted([]).open, {
      promise: {
        create: async () => ok({ promiseId: "pid-2" }),
        settle: async () => ok(null),
        info: async () => ok({ ...info("released"), id: "pid-2" }),
        find: async () => ok([]),
      },
      approveOrder: async () => ok({ finalUrl: "https://x" }),
      orderStatus: async () => ok({ status: "APPROVED" }),
    });
    const { ret } = await collect(runPromiseAgent({ agent: "promise-1", session: mkSession(), deps }, `unlock ${SLUG}`));
    expect(ret).toContain("released");
    expect(ret).not.toContain("token=pid-2&");
  });

  it("answers an unnamed paywall task with the premium slug list instead of guessing", async () => {
    let created = false;
    const deps = mkDeps(scripted([]).open, {
      promise: {
        create: async () => {
          created = true;
          return ok({ promiseId: "x" });
        },
        settle: async () => ok(null),
        info: async () => ok(info("open")),
        find: async () => ok([]),
      },
    });
    const { ret } = await collect(runPromiseAgent({ agent: "promise-1", session: mkSession(), deps }, "Create a standing promise to unlock the premium Newsroom article and return the promise id"));
    expect(created).toBe(false);
    expect(ret).toContain("micropayment-economics-agents");
    expect(ret).toContain("verifiable-agent-spending");
  });

  it("answers status questions without touching the money path", async () => {
    let created = false;
    const deps = mkDeps(scripted([]).open, {
      promise: {
        create: async () => {
          created = true;
          return ok({ promiseId: "x" });
        },
        settle: async () => ok(null),
        info: async () => ok(info("open")),
        find: async () => ok([info("captured"), { ...info("open"), id: "pid-9", title: "Nike Pegasus under 120" }]),
      },
    });
    const { ret } = await collect(runPromiseAgent({ agent: "promise-1", session: mkSession(), deps }, "what is the status of my Nike promise"));
    expect(created).toBe(false);
    expect(ret).toContain("Nike Pegasus under 120");
    expect(ret).toContain("captured");
  });
});
