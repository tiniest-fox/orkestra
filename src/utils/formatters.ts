/**
 * Formatting utilities for display.
 */

/**
 * Convert a snake_case string to Title Case.
 * e.g. "breaking_down" -> "Breaking Down", "planning" -> "Planning"
 */
export function titleCase(str: string): string {
  if (!str) return str;
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format file path for display (truncate long paths).
 */
export function formatPath(path: string): string {
  const maxLen = 50;
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

/**
 * Format timestamp for display.
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
