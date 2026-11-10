/** Joins class names, skipping anything falsy. (No class merging: components here do not pass conflicting utilities.) */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
