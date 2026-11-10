import { describe, expect, it } from "vitest";
import { MAX_IMAGES } from "@/lib/computer/images";
import { MAX_ORIGINAL_BYTES, dataOf, fitWithin, plansFor, refuseFile } from "./image-prep";

describe("fitWithin", () => {
  it.each([
    [4000, 2000, 1400, { w: 1400, h: 700 }],
    [2000, 4000, 1400, { w: 700, h: 1400 }],
    [800, 600, 1400, { w: 800, h: 600 }], // never enlarged
    [1, 5000, 1400, { w: 1, h: 1400 }],
    [10000, 1, 1400, { w: 1400, h: 1 }], // never zero
    [0, 0, 1400, { w: 1, h: 1 }],
  ])("%i x %i within %i", (w, h, max, want) => expect(fitWithin(w, h, max)).toEqual(want));
});

describe("refuseFile", () => {
  const ok = { type: "image/png", size: 1000, name: "a.png" };
  it("accepts a normal image", () => expect(refuseFile(ok, 0)).toBeNull());
  it("refuses a fourth image", () => expect(refuseFile(ok, MAX_IMAGES)).toMatch(/At most 3/));
  it.each(["application/pdf", "image/svg+xml", "text/plain", ""])("refuses type %j", (type) => expect(refuseFile({ ...ok, type }, 0)).toMatch(/not a PNG/));
  it("refuses a huge original", () => expect(refuseFile({ ...ok, size: MAX_ORIGINAL_BYTES + 1 }, 0)).toMatch(/15 MB/));
});

describe("plansFor", () => {
  it("tries PNG first only for PNG input, then shrinking JPEGs", () => {
    expect(plansFor("image/png")[0]).toMatchObject({ type: "image/png" });
    expect(plansFor("image/webp")[0]).toMatchObject({ type: "image/jpeg", max: 1400 });
    const p = plansFor("image/png");
    expect(p.slice(1).map((x) => x.max)).toEqual([...p.slice(1).map((x) => x.max)].sort((a, b) => b - a));
  });
});

describe("dataOf", () => {
  it("takes the base64 part", () => expect(dataOf("data:image/jpeg;base64,/9j/AAAA==")).toBe("/9j/AAAA=="));
  it.each(["data:text/html;base64,AAAA", "https://x.test/a.png", "data:image/png,raw"])("rejects %s", (u) => expect(dataOf(u)).toBeNull());
});
