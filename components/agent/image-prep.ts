import { MAX_IMAGES, MAX_IMAGE_B64 } from "@/lib/computer/images";

/** A picture ready to send: shrunk, base64, plus a local URL for the thumbnail (never uploaded). */
export interface PendingImage {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg";
  data: string;
  url: string;
}
export const MAX_ORIGINAL_BYTES = 15_000_000;
const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Pure. Why a file cannot be attached, or null when it can. */
export function refuseFile(f: { type: string; size: number; name: string }, haveAlready: number): string | null {
  if (haveAlready >= MAX_IMAGES) return `At most ${MAX_IMAGES} images per message.`;
  if (!OK_TYPES.includes(f.type)) return `${f.name || "That file"} is not a PNG, JPEG, WebP or GIF image.`;
  if (f.size > MAX_ORIGINAL_BYTES) return `${f.name || "That image"} is larger than 15 MB.`;
  return null;
}

/** Pure. The size to draw at: the longest side at most `max`, never enlarged, never zero. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export interface Plan {
  max: number;
  type: "image/png" | "image/jpeg";
  quality: number;
}
/** Pure. Encodings to try, best first, until one fits the server's limit. PNG first for PNG input keeps screenshot text sharp. */
export const plansFor = (inputType: string): Plan[] => [
  ...(inputType === "image/png" ? [{ max: 1400, type: "image/png" as const, quality: 1 }] : []),
  { max: 1400, type: "image/jpeg", quality: 0.85 },
  { max: 1100, type: "image/jpeg", quality: 0.72 },
  { max: 800, type: "image/jpeg", quality: 0.6 },
  { max: 600, type: "image/jpeg", quality: 0.5 },
];

/** Pure. base64 of a data URL, or null when it is not a base64 data URL. */
export const dataOf = (dataUrl: string): string | null => /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)?.[1] ?? null;

/** Browser only. Decodes, shrinks and re-encodes an image so it fits the request. Throws a readable message when it cannot. */
export async function prepareImage(file: File): Promise<PendingImage> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(`${file.name || "That file"} could not be read as an image.`);
  try {
    for (const p of plansFor(file.type)) {
      const { w, h } = fitWithin(bmp.width, bmp.height, p.max);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot resize images.");
      if (p.type === "image/jpeg") {
        ctx.fillStyle = "#ffffff"; // JPEG has no transparency: a transparent PNG would turn black
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      const url = canvas.toDataURL(p.type, p.quality);
      const data = dataOf(url);
      if (data && data.length <= MAX_IMAGE_B64) return { id: crypto.randomUUID(), name: file.name || "image", mime: p.type, data, url };
    }
    throw new Error(`${file.name || "That image"} is too detailed to send. Try a smaller screenshot.`);
  } finally {
    bmp.close();
  }
}
