import { describe, expect, it } from "vitest";
import { MIN_POPOVER_HEIGHT, fitPopover } from "./popover-fit";

// a 800px-high window; the button is 36px tall
const win = (top: number, want = 460) => fitPopover({ anchorTop: top, anchorBottom: top + 36, viewportH: 800, want });

describe("fitPopover", () => {
  it("opens above when it fits there, as it does for the prompt box low in the window", () => {
    expect(win(700)).toEqual({ side: "above", maxHeight: 460 });
  });
  it("opens below when it does not fit above but does below (the big prompt box in the middle of the home screen)", () => {
    expect(win(280)).toEqual({ side: "below", maxHeight: 460 }); // 260 above, 464 below
    expect(win(300)).toEqual({ side: "below", maxHeight: 444 }); // 280 above, 444 below: it fits nowhere whole, so the roomier side, capped
  });
  it("when neither side has the room, takes the roomier one and caps its height so nothing leaves the window", () => {
    const up = win(420); // 400 above, 328 below
    expect(up.side).toBe("above");
    expect(up.maxHeight).toBeLessThanOrEqual(420 - 8 - 12);
    const down = win(200, 700); // 180 above, 552 below
    expect(down.side).toBe("below");
    expect(down.maxHeight).toBe(800 - 236 - 8 - 12);
  });
  it("never leaves the window: the popover's far edge stays inside, with the margin", () => {
    for (let top = 0; top <= 764; top += 17) for (const want of [200, 460, 900]) {
      const f = fitPopover({ anchorTop: top, anchorBottom: top + 36, viewportH: 800, want });
      const edge = f.side === "above" ? top - 8 - f.maxHeight : top + 36 + 8 + f.maxHeight;
      if (f.maxHeight > MIN_POPOVER_HEIGHT) expect(f.side === "above" ? edge : 800 - edge).toBeGreaterThanOrEqual(12);
    }
  });
  it("is never smaller than a short list is worth, and never taller than it asked", () => {
    expect(fitPopover({ anchorTop: 10, anchorBottom: 40, viewportH: 120, want: 400 }).maxHeight).toBe(MIN_POPOVER_HEIGHT);
    expect(win(700, 120).maxHeight).toBe(MIN_POPOVER_HEIGHT);
    expect(win(700, 300).maxHeight).toBe(300);
  });
});
