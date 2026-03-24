// Shared hook for find bar state and match-to-scroll navigation in diff views.

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useNavHandler } from "../ui/HotkeyScope";
import type { DiffContentHandle } from "./DiffContent";
import type { DiffMatch, UseDiffSearchResult } from "./useDiffSearch";

interface UseDiffFindNavigationArgs {
  search: UseDiffSearchResult;
  files: { path: string }[];
  collapsedPaths: Set<string>;
  expandForSearch: (path: string) => void;
  diffContentRef: RefObject<DiffContentHandle | null>;
  scrollEl: HTMLElement | null;
  /** Whether the parent component/tab is active (for hotkey gating). */
  active?: boolean;
}

interface UseDiffFindNavigationResult {
  findBarOpen: boolean;
  setFindBarOpen: (open: boolean) => void;
  closeFindBar: () => void;
}

export function useDiffFindNavigation({
  search,
  files,
  collapsedPaths,
  expandForSearch,
  diffContentRef,
  scrollEl,
  active = true,
}: UseDiffFindNavigationArgs): UseDiffFindNavigationResult {
  const [findBarOpen, setFindBarOpen] = useState(false);

  const closeFindBar = useCallback(() => {
    setFindBarOpen(false);
    search.setQuery("");
  }, [search.setQuery]);

  useNavHandler("meta+f", () => {
    if (active) setFindBarOpen(true);
  });
  useNavHandler("ctrl+f", () => {
    if (active) setFindBarOpen(true);
  });

  function navigateToMatch(match: DiffMatch | null) {
    if (!match || files.length === 0) return;
    const file = files[match.fileIndex];
    if (!file) return;
    // Expand collapsed file without setting the user-interaction flag.
    if (collapsedPaths.has(file.path)) expandForSearch(file.path);
    // Phase 1: scroll file into virtualizer viewport.
    diffContentRef.current?.scrollToFile(file.path);
    // Phase 2: wait for React to commit the expandForSearch state update, then
    // scroll to the specific matching line.
    requestAnimationFrame(() => {
      const el = scrollEl?.querySelector('[data-search-current="true"]');
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  // Use a ref to hold the latest navigateToMatch closure, avoiding stale closure
  // issues while keeping the effect dependency array clean.
  const navigateRef = useRef(navigateToMatch);
  navigateRef.current = navigateToMatch;

  useEffect(() => {
    navigateRef.current(search.currentMatch);
  }, [search.currentMatch]);

  return { findBarOpen, setFindBarOpen, closeFindBar };
}
