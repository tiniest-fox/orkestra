//! Hook that computes and manages auto-collapsed file paths for diff views.

import { useEffect, useRef, useState } from "react";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { shouldAutoCollapse } from "./shouldAutoCollapse";

interface UseAutoCollapsePathsResult {
  collapsedPaths: Set<string>;
  toggleCollapsed: (path: string) => void;
  resetInteraction: () => void;
  expandForSearch: (path: string) => void;
}

export function useAutoCollapsePaths(
  files: HighlightedFileDiff[] | undefined,
): UseAutoCollapsePathsResult {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const userHasInteractedRef = useRef(false);

  useEffect(() => {
    if (!files) {
      setCollapsedPaths(new Set());
      userHasInteractedRef.current = false;
      return;
    }
    if (userHasInteractedRef.current) return;
    const initial = new Set<string>();
    for (const file of files) {
      if (shouldAutoCollapse(file)) initial.add(file.path);
    }
    setCollapsedPaths(initial);
  }, [files]);

  function toggleCollapsed(path: string) {
    userHasInteractedRef.current = true;
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function resetInteraction() {
    userHasInteractedRef.current = false;
  }

  // Expand a file for search navigation without setting the user-interaction flag,
  // so auto-collapse still applies on the next diff load.
  function expandForSearch(path: string) {
    setCollapsedPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  return { collapsedPaths, toggleCollapsed, resetInteraction, expandForSearch };
}
