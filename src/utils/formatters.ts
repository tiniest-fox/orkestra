/**
 * Formatting utilities for display.
 */

const WORKTREE_RE = /\.orkestra[/\\]\.worktrees[/\\][^/\\]+[/\\]/;

/**
 * Format file path for display.
 *
 * Resolution order:
 * 1. Strip `.orkestra/.worktrees/<id>/` prefix if present.
 * 2. Strip `projectRoot` prefix if provided and path starts with it.
 * 3. Fall back to last-3-segments truncation for long unmatched paths.
 *
 * Long relative paths (>50 chars) are truncated to last 3 segments.
 */
export function formatPath(path: string, projectRoot?: string): string {
  const maxLen = 50;

  // 1. Worktree detection — strip everything up to and including the task ID segment.
  const worktreeMatch = WORKTREE_RE.exec(path);
  if (worktreeMatch) {
    const relative = path.slice(worktreeMatch.index + worktreeMatch[0].length);
    return truncateRelative(relative, maxLen);
  }

  // 2. projectRoot stripping.
  if (projectRoot) {
    const root = projectRoot.replace(/\/+$/, "");
    if (path.startsWith(root + "/")) {
      const relative = path.slice(root.length + 1);
      return truncateRelative(relative, maxLen);
    }
    if (path === root) {
      const parts = root.split("/");
      return parts[parts.length - 1] || ".";
    }
  }

  // 3. Existing truncation fallback.
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function truncateRelative(relative: string, maxLen: number): string {
  if (relative.length <= maxLen) return relative;
  const parts = relative.split("/");
  if (parts.length <= 3) return relative;
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
