// Title-case a slug by splitting on underscores and hyphens.

export function titleCase(s: string): string {
  return s
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
