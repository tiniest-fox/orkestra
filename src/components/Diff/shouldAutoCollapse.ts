//! Predicate for determining whether a file diff should start collapsed.

import type { HighlightedFileDiff } from "../../hooks/useDiff";

export function shouldAutoCollapse(file: HighlightedFileDiff): boolean {
  if (file.change_type === "deleted") return true;
  if (file.additions + file.deletions >= 300) return true;
  return false;
}
