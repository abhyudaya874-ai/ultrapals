import { describe, expect, it } from "vitest";
import { parseSnapshot, toScreen } from "@/lib/integrations/kbrowser";
import { liveViewSrc, safeLiveViewUrl } from "./live-view";

describe("safeLiveViewUrl", () => {
  it("accepts kernel hosts over https (shape from the live-view docs)", () => {
    expect(safeLiveViewUrl("https://prod-iad-hypeman-61.kernel.sh:8443/browser/live/abc")?.hostname).toBe("prod-iad-hypeman-61.kernel.sh");
    expect(safeLiveViewUrl("https://api.onkernel.com/browser/live/abc")).not.toBeNull();
  });
  it("refuses everything else", () => {
    for (const u of ["http://x.kernel.sh/a", "https://evil.example/kernel.sh", "https://kernel.sh.evil.example/a", "https://user:pw@x.kernel.sh/a", "javascript:alert(1)", "https://notkernel.sh/a", "", null, 5])
      expect(safeLiveViewUrl(u)).toBeNull();
  });
  it("adds readOnly as documented and keeps the token path", () => {
    expect(liveViewSrc("https://a.kernel.sh:8443/browser/live/T", true)).toBe("https://a.kernel.sh:8443/browser/live/T?readOnly=true");
    expect(liveViewSrc("https://a.kernel.sh/browser/live/T?readOnly=true", false)).toBe("https://a.kernel.sh/browser/live/T?readOnly=false");
    expect(liveViewSrc("https://evil.example/x", true)).toBeNull();
  });
});

describe("toScreen", () => {
  it("applies the calibrated offset (87px measured live) and clamps to the screen the API accepts", () => {
    expect(toScreen(640, 413, { offX: 0, offY: 87 })).toEqual({ x: 640, y: 500 });
    expect(toScreen(5000, 5000, { offX: 0, offY: 87 })).toEqual({ x: 1279, y: 799 });
    expect(toScreen(-9, -9, { offX: 0, offY: 87 })).toEqual({ x: 0, y: 78 });
  });
});

describe("parseSnapshot", () => {
  it("accepts a page snapshot and rejects junk", () => {
    const ok = { url: "https://a.example", title: "A", text: "t", elements: [{ i: 0, tag: "a", label: "x", x: 1, y: 2 }] };
    expect(parseSnapshot(ok)).toEqual(ok);
    expect(parseSnapshot({ url: 1 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});
