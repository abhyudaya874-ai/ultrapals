import { describe, expect, it } from "vitest";
import { APP_NAME, PAL_NAMES, palName } from "./pals";

describe("palName", () => {
  it("names every role with a Pal", () => {
    for (const n of Object.values(PAL_NAMES)) expect(n.endsWith("Pal")).toBe(true);
    expect(APP_NAME).toBe("UltraPals");
  });
  it.each([
    ["main", "UltraPal"],
    ["rival-2", "RivalPal"],
    ["research-1", "ResearchPal"],
    ["browser-12", "BrowserPal"],
    ["terminal-2", "TerminalPal"],
    ["promise-4", "PromisePal"],
    ["mystery-1", "Mystery"],
  ])("%s -> %s", (id, want) => expect(palName(id)).toBe(want));
});
