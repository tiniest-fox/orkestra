//! Hook managing new-task modal open/close state.

import { useCallback, useState } from "react";

/** Manages the new-task modal open/close state. */
export function useNewTask() {
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);

  const openNewTask = useCallback(() => setIsNewTaskOpen(true), []);
  const closeNewTask = useCallback(() => setIsNewTaskOpen(false), []);

  return { isNewTaskOpen, openNewTask, closeNewTask };
}
