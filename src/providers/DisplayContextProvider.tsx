/**
 * DisplayContext - Single source of truth for app navigation state.
 *
 * Two dimensions:
 * - View: What occupies the main content area (Board, future: Archive, Git, etc.)
 * - Focus: What's open in the side panel (nothing, a task, a task+subtask, create form)
 *
 * All navigation (clicking task cards, command palette results, close buttons)
 * routes through DisplayContext transitions.
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

// =============================================================================
// Types
// =============================================================================

/** What occupies the main content area. */
export type View = { type: "board" };

/** What's open in the side panel. */
export type Focus =
  | { type: "none" }
  | { type: "create" }
  | { type: "task"; taskId: string; subtaskId?: string; showDiff?: boolean };

export interface DisplayContextValue {
  view: View;
  focus: Focus;

  /** Open a task in the side panel. */
  focusTask: (taskId: string) => void;

  /** Open a subtask alongside its parent task. */
  focusSubtask: (taskId: string, subtaskId: string) => void;

  /** Close the subtask panel, keeping the parent task open. */
  closeSubtask: () => void;

  /** Open the create-task panel. */
  openCreate: () => void;

  /** Close whatever is in the side panel. */
  closeFocus: () => void;

  /** Open the diff viewer for the current task. */
  openDiff: () => void;

  /** Close the diff viewer. */
  closeDiff: () => void;
}

// =============================================================================
// Context
// =============================================================================

const DisplayContext = createContext<DisplayContextValue | null>(null);

/**
 * Access the current display context. Must be used within DisplayContextProvider.
 */
export function useDisplayContext(): DisplayContextValue {
  const ctx = useContext(DisplayContext);
  if (!ctx) {
    throw new Error("useDisplayContext must be used within DisplayContextProvider");
  }
  return ctx;
}

// =============================================================================
// Provider
// =============================================================================

interface DisplayContextProviderProps {
  children: ReactNode;
}

export function DisplayContextProvider({ children }: DisplayContextProviderProps) {
  const [view] = useState<View>({ type: "board" });
  const [focus, setFocus] = useState<Focus>({ type: "none" });

  const focusTask = useCallback((taskId: string) => {
    setFocus({ type: "task", taskId });
  }, []);

  const focusSubtask = useCallback((taskId: string, subtaskId: string) => {
    setFocus({ type: "task", taskId, subtaskId });
  }, []);

  const closeSubtask = useCallback(() => {
    setFocus((prev) => {
      if (prev.type === "task") {
        return { type: "task", taskId: prev.taskId };
      }
      return prev;
    });
  }, []);

  const openCreate = useCallback(() => {
    setFocus({ type: "create" });
  }, []);

  const closeFocus = useCallback(() => {
    setFocus({ type: "none" });
  }, []);

  const openDiff = useCallback(() => {
    setFocus((prev) => {
      if (prev.type === "task") {
        // Close subtask if open, open diff
        return { type: "task", taskId: prev.taskId, showDiff: true };
      }
      return prev;
    });
  }, []);

  const closeDiff = useCallback(() => {
    setFocus((prev) => {
      if (prev.type === "task") {
        return { type: "task", taskId: prev.taskId, showDiff: false };
      }
      return prev;
    });
  }, []);

  const value = useMemo<DisplayContextValue>(
    () => ({
      view,
      focus,
      focusTask,
      focusSubtask,
      closeSubtask,
      openCreate,
      closeFocus,
      openDiff,
      closeDiff,
    }),
    [view, focus, focusTask, focusSubtask, closeSubtask, openCreate, closeFocus, openDiff, closeDiff],
  );

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}
