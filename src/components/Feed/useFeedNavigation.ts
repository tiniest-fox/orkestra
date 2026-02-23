//! Keyboard and mouse focus management for the Feed row list.

import { useEffect, useState } from "react";

export function useFeedNavigation(
  orderedIds: string[],
  disabled = false,
  onEnter?: (id: string) => void,
) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Incremented only on keyboard navigation — passed to NavigationScope so hover
  // updates visual state without triggering jarring auto-scroll.
  const [scrollSeq, setScrollSeq] = useState(0);

  // Initialise to first item; reset if the focused item leaves the list.
  useEffect(() => {
    if (orderedIds.length === 0) {
      setFocusedId(null);
      return;
    }
    setFocusedId((prev) => (prev && orderedIds.includes(prev) ? prev : orderedIds[0]));
  }, [orderedIds]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (disabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Enter") {
        setFocusedId((prev) => {
          if (prev) onEnter?.(prev);
          return prev;
        });
        return;
      }

      if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) return;

      e.preventDefault();

      setFocusedId((prev) => {
        const idx = prev ? orderedIds.indexOf(prev) : -1;
        if (e.key === "ArrowDown" || e.key === "j") {
          return orderedIds[Math.min(idx + 1, orderedIds.length - 1)] ?? prev;
        } else {
          return orderedIds[Math.max(idx - 1, 0)] ?? prev;
        }
      });
      setScrollSeq((n) => n + 1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedIds, disabled, onEnter]);

  return { focusedId, setFocusedId, scrollSeq };
}
