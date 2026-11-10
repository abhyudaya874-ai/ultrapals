import { describe, expect, it } from "vitest";
import { applyCEvent, newRun } from "./run";
import { avatarOf, groupVisits, hostOfUrl, readVisit, searchVisit, type Visit } from "./visits";

const asVisit = (e: ReturnType<typeof readVisit>): Visit => ({ id: e.id, agent: e.agent, action: e.action, label: e.label, url: e.url, title: e.title, via: e.via, state: e.state });

describe("visits", () => {
  it("hostOfUrl strips www and tolerates junk", () => {
    expect(hostOfUrl("https://www.docs.stripe.com/a?b=1")).toBe("docs.stripe.com");
    expect(hostOfUrl("not a url")).toBe("");
    expect(hostOfUrl(undefined)).toBe("");
  });
  it("avatarOf is stable per host and never needs a remote image", () => {
    expect(avatarOf("stripe.com")).toEqual(avatarOf("stripe.com"));
    expect(avatarOf("stripe.com").letter).toBe("S");
    expect(avatarOf("").letter).toBe("?");
    expect(avatarOf("a.com").hue).toBeGreaterThanOrEqual(0);
  });
  it("groupVisits groups pages by host, dedupes tracking variants and counts distinct pages", () => {
    const v = [readVisit("a", "https://docs.stripe.com/refunds?utm_source=x", "Refunds", "tavily"), readVisit("b", "https://docs.stripe.com/refunds", "Refunds", "exa"), readVisit("a", "https://docs.stripe.com/disputes", "Disputes", "exa"), readVisit("a", "https://squareup.com/x", "S", "fetch"), searchVisit("a", "s1", "stripe refunds", "tavily", "ok", 10)];
    const g = groupVisits(v.map(asVisit));
    expect(g.pages).toBe(3);
    expect(g.hosts.map((h) => [h.host, h.pages.length])).toEqual([["docs.stripe.com", 2], ["squareup.com", 1]]);
    expect(g.searches).toHaveLength(1);
  });
  it("the reducer keeps one entry per id (a search goes running -> ok in place) and the same page read twice once", () => {
    let r = newRun("r", "p");
    r = applyCEvent(r, searchVisit("a", "s1", "q", "tavily", "running"));
    r = applyCEvent(r, searchVisit("a", "s1", "q", "tavily", "ok", 8));
    r = applyCEvent(r, readVisit("a", "https://x.example.com/p", "P", "tavily"));
    r = applyCEvent(r, readVisit("b", "https://x.example.com/p?utm_source=1", "P", "exa"));
    expect(r.visits.filter((v) => v.action === "search")).toEqual([expect.objectContaining({ state: "ok", count: 8 })]);
    expect(r.visits.filter((v) => v.action === "read")).toHaveLength(1);
  });
  it("a page the browser opened shows up as a read", () => {
    const r = applyCEvent(newRun("r", "p"), { kind: "page", url: "https://developer.example.com/api", title: "API" });
    expect(r.visits).toEqual([expect.objectContaining({ action: "read", via: "browser", url: "https://developer.example.com/api" })]);
  });
});
