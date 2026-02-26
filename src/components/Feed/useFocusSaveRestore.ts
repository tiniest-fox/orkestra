//! Hook that saves and restores keyboard focus when entering and leaving filter mode.

import { useCallback, useRef, useState } from "react";

interface UseFocusSaveRestoreArgs {
  currentFocusedId: string | null;
  onRestoreFocus: (id: string) => void;
}

interface UseFocusSaveRestoreReturn {
  filterText: string;
  handleFilterChange: (text: string) => void;
  clearFilter: () => void;
}

/**
 * Saves the focused item ID when the user enters filter mode and restores it when they
 * clear the filter. The re-entry guard (`preFocusIdRef.current === null`) prevents
 * overwriting the saved focus if the user types additional characters after the initial
 * filter entry.
 */
export function useFocusSaveRestore({
  currentFocusedId,
  onRestoreFocus,
}: UseFocusSaveRestoreArgs): UseFocusSaveRestoreReturn {
  const [filterText, setFilterText] = useState("");
  const preFocusIdRef = useRef<string | null>(null);

  const clearFilter = useCallback(() => {
    setFilterText("");
    if (preFocusIdRef.current) {
      onRestoreFocus(preFocusIdRef.current);
      preFocusIdRef.current = null;
    }
  }, [onRestoreFocus]);

  const handleFilterChange = useCallback(
    (text: string) => {
      if (!filterText && text && preFocusIdRef.current === null) {
        // Entering filter mode for the first time — save current focus.
        preFocusIdRef.current = currentFocusedId;
      }
      if (filterText && !text) {
        // Leaving filter mode — restore previous focus.
        clearFilter();
        return;
      }
      setFilterText(text);
    },
    [filterText, currentFocusedId, clearFilter],
  );

  return { filterText, handleFilterChange, clearFilter };
}
