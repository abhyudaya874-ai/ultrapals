import type { Maker } from "@/lib/computer/models";
import { BRAND_PATHS } from "./brand-icons";

/** The company mark of whoever made a model (OpenAI, Google, NVIDIA, Qwen). Drawn in the text colour, like the icons beside Perplexity's and Devin's model names. */
export function BrandIcon({ maker, className = "size-4" }: { maker: Maker; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={`shrink-0 ${className}`} aria-hidden="true" data-maker={maker}>
      <path d={BRAND_PATHS[maker]} />
    </svg>
  );
}
