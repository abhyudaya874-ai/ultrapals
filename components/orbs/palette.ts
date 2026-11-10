/** Pure. Who an agent is, as an orb: tier (how fancy), colours and which eye colour reads on them. */
export type Tier = "worker" | "pal" | "ultra" | "battle";

/** Plain colours for the working agents. Each role has its own, so a row of them can be told apart at a glance. */
export const WORKER_COLOR: Record<string, string> = {
  research: "#4e99a3",
  browser: "#5b9bd5",
  terminal: "#519b53",
  sandbox: "#8a8f98",
};
/** Fixed gradients for the Pals that lead others. */
export const PAL_GRADIENT: Record<string, [string, string, string]> = {
  promise: ["#c9a14a", "#f0d28a", "#e8a07a"],
  rival: ["#d2646e", "#f0a0a8", "#8f7fe0"],
  situation: ["#8f7fe0", "#6fb5e8", "#7dd3c7"],
};

/** Pure. FNV-1a, so the same id always gets the same colours. */
export function hash(id: string): number {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) {
    x ^= id.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

/** Pure. h 0..360, s and l 0..100 -> "#rrggbb". */
export function hsl(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Pure. A three-colour gradient for any id: a base hue, a neighbour and a contrasting accent, all soft enough to sit under dark eyes. */
export function gradientFor(id: string): [string, string, string] {
  const h = hash(id) % 360;
  return [hsl(h, 72, 66), hsl((h + 38) % 360, 78, 72), hsl((h + 160) % 360, 66, 76)];
}

/** Pure. Dark eyes on a light body, light eyes on a dark one. */
export function eyeOn(hex: string): string {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  if (Number.isNaN(n)) return "#09090B";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#09090B" : "#F4F4F5";
}

/** Pure. The role of an agent id: "superpal-stripe" -> superpal, "research-3" -> research, "main" -> main. */
export const roleOf = (id: string): string => (id.startsWith("superpal-") ? "superpal" : id.replace(/-.*$/, ""));

export function tierOf(role: string): Tier {
  if (role === "main") return "ultra";
  if (role === "battle") return "battle";
  if (role === "superpal" || role in PAL_GRADIENT) return "pal";
  return "worker";
}

export type OrbLook =
  | { kind: "plain"; color: string; eye: string }
  | { kind: "gradient"; colors: [string, string, string]; eye: string };

/** Pure. The look for an agent: plain for the workers, a gradient for the Pals and SuperPals, a gradient from the persona for a battle contender. */
export function lookFor(id: string, role: string = roleOf(id)): OrbLook {
  const tier = tierOf(role);
  if (tier === "worker") {
    const color = WORKER_COLOR[role] ?? hsl(hash(role) % 360, 55, 62);
    return { kind: "plain", color, eye: eyeOn(color) };
  }
  const colors = PAL_GRADIENT[role] ?? gradientFor(id);
  return { kind: "gradient", colors, eye: "#0C0C10" };
}
