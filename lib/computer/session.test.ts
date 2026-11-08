import { describe, expect, it } from "vitest";
import type { WebSource } from "@/lib/integrations/types";
import type { Source } from "@/lib/research/sources";
import { endSession, getSession, hasSession, mergeInto, pushHistory, remapCitations } from "./session";

const w = (url: string, snippet = "s"): WebSource => ({ url, title: url, snippet, publishedDate: null, provider: "tavily", score: null });

describe("mergeInto", () => {
  it("numbers new pages after the existing ones and reuses the number for a page already seen", () => {
    const a = mergeInto([], [w("https://a.example/1"), w("https://b.example/2")]);
    expect(a.map).toEqual([1, 2]);
    const b = mergeInto(a.sources, [w("https://www.b.example/2/?utm_x=1"), w("https://c.example/3")]);
    expect(b.map).toEqual([2, 3]);
    expect(b.sources.map((s) => [s.n, s.host])).toEqual([[1, "a.example"], [2, "b.example"], [3, "c.example"]]);
  });
  it("never renumbers existing sources and drops (0) when full", () => {
    const base: Source[] = [{ ...w("https://a.example/1"), n: 1, host: "a.example" }];
    expect(mergeInto(base, [w("https://z.example/9")], 1)).toMatchObject({ map: [0] });
    expect(mergeInto(base, [w("https://z.example/9")]).sources[0].n).toBe(1);
  });
  it("does not mutate its input", () => {
    const base: Source[] = [];
    mergeInto(base, [w("https://a.example")]);
    expect(base).toEqual([]);
  });
});

describe("remapCitations", () => {
  it("rewrites local numbers to global ones, including gpt-oss 【n】", () => {
    expect(remapCitations("A [1] B [2][3] C 【2】.", [5, 6, 7])).toBe("A [5] B [6][7] C [6].");
  });
  it("removes markers whose source was dropped and leaves unknown numbers as text", () => {
    expect(remapCitations("A [1] B [2].", [4, 0])).toBe("A [4] B .");
    expect(remapCitations("A [9].", [4])).toBe("A [9].");
  });
});

describe("pushHistory", () => {
  it("keeps the newest eight turns and clips long ones", () => {
    let h: { role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i < 12; i++) h = pushHistory(h, { role: "user", content: `m${i}` });
    expect(h).toHaveLength(8);
    expect(h[0].content).toBe("m4");
    expect(pushHistory([], { role: "assistant", content: "x".repeat(5000) })[0].content).toHaveLength(1500);
  });
});

describe("sessions", () => {
  it("creates, finds by id, and ends a session (closing its VM)", async () => {
    const closed: string[] = [];
    const s = getSession(undefined, async (id) => void closed.push(id));
    expect(getSession(s.id, async () => undefined)).toBe(s);
    s.vm = { id: "vm-1", liveViewUrl: "https://a.kernel.sh/x", offX: 0, offY: 87 };
    expect(await endSession(s.id, async (id) => void closed.push(id))).toBe(true);
    expect(closed).toEqual(["vm-1"]);
    expect(hasSession(s.id)).toBe(false);
    expect(await endSession(s.id, async () => undefined)).toBe(false);
  });
});
