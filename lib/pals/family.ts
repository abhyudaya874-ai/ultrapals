import type { ModelRef } from "@/lib/computer/model";

/** Pure. The model family from a vendor-prefixed id ("openai/gpt-oss-120b" -> openai). An id with no prefix is its own family. */
export const familyOf = (model: string): string => {
  const m = model.replace(/:free$/i, "");
  return m.includes("/") ? m.split("/")[0].toLowerCase() : m.toLowerCase();
};
/** Pure. callModel returns the BARE model name; recover the family by finding it in the roster. Unknown = its own family. */
export function familyOfBare(bare: string, models: readonly ModelRef[]): string {
  const hit = models.find((m) => m.model.split("/").pop()?.replace(/:free$/i, "") === bare.replace(/:free$/i, ""));
  return hit ? familyOf(hit.model) : bare.toLowerCase();
}
/** Pure. The roster without the families already used (the blind reader must not share a family with the classifier). */
export const excludeFamilies = (models: readonly ModelRef[], used: ReadonlySet<string>): ModelRef[] => models.filter((m) => !used.has(familyOf(m.model)) && m.model !== "openrouter/free");
