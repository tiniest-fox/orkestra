/**
 * Hook for smart default selection from an ordered list of items.
 *
 * Picks the most contextually relevant item based on the task's current stage.
 * Used by ArtifactsTab (artifact selection) and useLogs (log stage selection).
 *
 * Heuristic:
 * 1. If the task has a current_stage matching an available item, select it.
 * 2. Otherwise, select the last item (most recently produced).
 * 3. If no items are available, return null.
 *
 * Manual user selections are preserved unless the selected item disappears
 * from availableItems or the task changes entirely.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSmartDefaultParams {
  /** Task ID — resets selection when this changes. */
  taskId: string;
  /** The task's current stage name, used for the heuristic. */
  currentStage: string | null;
  /** Ordered list of available item names (in workflow stage order). */
  availableItems: string[];
  /** Whether the consuming tab is currently visible. */
  isActive: boolean;
}

interface UseSmartDefaultResult {
  /** The currently selected item. */
  selectedItem: string | null;
  /** Set the selected item manually (user click). */
  setSelectedItem: (item: string | null) => void;
}

function pickSmartDefault(currentStage: string | null, availableItems: string[]): string | null {
  if (availableItems.length === 0) return null;
  if (currentStage && availableItems.includes(currentStage)) {
    return currentStage;
  }
  return availableItems[availableItems.length - 1];
}

export function useSmartDefault({
  taskId,
  currentStage,
  availableItems,
  isActive,
}: UseSmartDefaultParams): UseSmartDefaultResult {
  const [selectedItem, setSelectedItemInternal] = useState<string | null>(() =>
    pickSmartDefault(currentStage, availableItems),
  );
  const prevTaskIdRef = useRef(taskId);

  const setSelectedItem = useCallback((item: string | null) => {
    setSelectedItemInternal(item);
  }, []);

  // Reset to smart default when task changes
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      setSelectedItemInternal(pickSmartDefault(currentStage, availableItems));
    }
  }, [taskId, currentStage, availableItems]);

  // Re-evaluate when becoming active or when available items change
  useEffect(() => {
    if (!isActive) return;

    setSelectedItemInternal((current) => {
      // If current selection is still valid, keep it (respect manual override)
      if (current && availableItems.includes(current)) return current;
      // Otherwise, pick a new smart default
      return pickSmartDefault(currentStage, availableItems);
    });
  }, [isActive, availableItems, currentStage]);

  return { selectedItem, setSelectedItem };
}
