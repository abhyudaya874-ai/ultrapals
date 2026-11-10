import { describe, expect, it } from "vitest";
import { answerTextSoFar } from "./json-text";
import { pump } from "./pump";
import type { CEvent } from "./events";

const FULL = '{"thought":"done","action":"answer","text":"Line one\\nSays \\"hi\\" \\u00e9 and a \\\\ slash."}';
describe("answerTextSoFar", () => {
  it("is empty until the text key starts, and for a delegate action", () => {
    expect(answerTextSoFar('{"thought":"x","action":"deleg')).toBe("");
    expect(answerTextSoFar('{"action":"delegate","agent":"research","task":"find it"}')).toBe("");
  });
  it("decodes escapes and ends at the closing quote", () => expect(answerTextSoFar(FULL)).toBe('Line one\nSays "hi" é and a \\ slash.'));
  it("only ever grows as the JSON arrives, one character at a time (never rewrites what was shown)", () => {
    let prev = "";
    for (let i = 0; i <= FULL.length; i++) {
      const cur = answerTextSoFar(FULL.slice(0, i));
      expect(cur.startsWith(prev)).toBe(true);
      prev = cur;
    }
    expect(prev).toBe(answerTextSoFar(FULL));
  });
  it("waits for the end of an escape instead of printing half of it", () => {
    expect(answerTextSoFar('{"text":"a\\')).toBe("a");
    expect(answerTextSoFar('{"text":"a\\u00')).toBe("a");
  });
});

describe("pump", () => {
  it("yields events while the work is still running, not after", async () => {
    const seen: string[] = [];
    const g = pump<string>(async (emit) => {
      emit({ kind: "answer", delta: "a" });
      await new Promise((r) => setTimeout(r, 30));
      emit({ kind: "answer", delta: "b" });
      return "done";
    });
    const t0 = Date.now();
    for (;;) {
      const n = await g.next();
      if (n.done) { seen.push(`ret:${n.value}`); break; }
      seen.push(`${(n.value as Extract<CEvent, { kind: "answer" }>).delta}@${Date.now() - t0 < 20 ? "early" : "late"}`);
    }
    expect(seen).toEqual(["a@early", "b@late", "ret:done"]);
  });
  it("rethrows a failure after flushing what was emitted", async () => {
    const g = pump<string>(async (emit) => { emit({ kind: "answer", delta: "x" }); throw new Error("boom"); });
    expect((await g.next()).value).toMatchObject({ delta: "x" });
    await expect(g.next()).rejects.toThrow("boom");
  });
});
