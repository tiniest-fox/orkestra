/**
 * DisplayContext - Single source of truth for app navigation state.
 *
 * Uses a preset-based layout system where every user action maps to a named
 * preset that specifies which component fills each layout slot.
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { type LayoutPreset, type LayoutState, PRESETS } from "./presets";

// =============================================================================
// Types
// =============================================================================

export interface DisplayContextValue {
  layout: LayoutState;
  activePreset: LayoutPreset;

  // Forward navigation (stateless)
  showBoard(): void;
  showTask(taskId: string): void;
  showSubtask(taskId: string, subtaskId: string): void;
  showNewTask(): void;
  showTaskDiff(taskId: string): void;
  showSubtaskDiff(taskId: string, subtaskId: string): void;
  toggleGitHistory(): void;
  selectCommit(hash: string): void;
  deselectCommit(): void;
  toggleAssistant(): void;
  toggleAssistantHistory(): void;

  // Close/undo operations
  closeFocus(): void;
  closeSubtask(): void;
  closeDiff(): void;
  closeAssistantHistory(): void;

  // Archive modifier
  switchToArchive(): void;
  switchToActive(): void;

  // Smart navigation
  navigateToTask(taskId: string, parentId?: string): void;
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
  const [layout, setLayout] = useState<LayoutState>({
    preset: "Board",
    isArchive: false,
    taskId: null,
    subtaskId: null,
    commitHash: null,
  });

  const activePreset = useMemo(() => PRESETS[layout.preset], [layout.preset]);

  // Forward navigation
  const showBoard = useCallback(() => {
    setLayout((prev) => ({
      preset: "Board",
      isArchive: prev.isArchive,
      taskId: null,
      subtaskId: null,
      commitHash: null,
    }));
  }, []);

  const showTask = useCallback((taskId: string) => {
    setLayout((prev) => ({
      preset: "Task",
      isArchive: prev.isArchive,
      taskId,
      subtaskId: null,
      commitHash: null,
    }));
  }, []);

  const showSubtask = useCallback((taskId: string, subtaskId: string) => {
    setLayout((prev) => ({
      preset: "Subtask",
      isArchive: prev.isArchive,
      taskId,
      subtaskId,
      commitHash: null,
    }));
  }, []);

  const showNewTask = useCallback(() => {
    setLayout((prev) => ({
      preset: "NewTask",
      isArchive: prev.isArchive,
      taskId: null,
      subtaskId: null,
      commitHash: null,
    }));
  }, []);

  const showTaskDiff = useCallback((taskId: string) => {
    setLayout((prev) => ({
      preset: "TaskDiff",
      isArchive: prev.isArchive,
      taskId,
      subtaskId: null,
      commitHash: null,
    }));
  }, []);

  const showSubtaskDiff = useCallback((taskId: string, subtaskId: string) => {
    setLayout((prev) => ({
      preset: "SubtaskDiff",
      isArchive: prev.isArchive,
      taskId,
      subtaskId,
      commitHash: null,
    }));
  }, []);

  const toggleGitHistory = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "GitHistory" || prev.preset === "GitCommit") {
        return {
          preset: "Board",
          isArchive: prev.isArchive,
          taskId: null,
          subtaskId: null,
          commitHash: null,
        };
      }
      return {
        preset: "GitHistory",
        isArchive: prev.isArchive,
        taskId: null,
        subtaskId: null,
        commitHash: null,
      };
    });
  }, []);

  const selectCommit = useCallback((hash: string) => {
    setLayout((prev) => ({
      preset: "GitCommit",
      isArchive: prev.isArchive,
      taskId: null,
      subtaskId: null,
      commitHash: hash,
    }));
  }, []);

  const deselectCommit = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      preset: "GitHistory",
      commitHash: null,
    }));
  }, []);

  const toggleAssistant = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "Assistant" || prev.preset === "AssistantHistory") {
        return {
          preset: "Board",
          isArchive: prev.isArchive,
          taskId: null,
          subtaskId: null,
          commitHash: null,
        };
      }
      return {
        preset: "Assistant",
        isArchive: prev.isArchive,
        taskId: null,
        subtaskId: null,
        commitHash: null,
      };
    });
  }, []);

  const toggleAssistantHistory = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "AssistantHistory") {
        return { ...prev, preset: "Assistant" };
      }
      if (prev.preset === "Assistant") {
        return { ...prev, preset: "AssistantHistory" };
      }
      return prev;
    });
  }, []);

  // Close/undo operations
  const closeSubtask = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "Subtask" || prev.preset === "SubtaskDiff") {
        return { ...prev, preset: "Task", subtaskId: null };
      }
      return prev;
    });
  }, []);

  const closeDiff = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "TaskDiff") {
        return { ...prev, preset: "Task" };
      }
      if (prev.preset === "SubtaskDiff") {
        return { ...prev, preset: "Subtask" };
      }
      return prev;
    });
  }, []);

  const closeAssistantHistory = useCallback(() => {
    setLayout((prev) => {
      if (prev.preset === "AssistantHistory") {
        return { ...prev, preset: "Assistant" };
      }
      return prev;
    });
  }, []);

  const closeFocus = useCallback(() => {
    setLayout((prev) => ({
      preset: "Board",
      isArchive: prev.isArchive,
      taskId: null,
      subtaskId: null,
      commitHash: null,
    }));
  }, []);

  // Archive modifier
  const switchToArchive = useCallback(() => {
    setLayout((prev) => ({ ...prev, isArchive: true }));
  }, []);

  const switchToActive = useCallback(() => {
    setLayout((prev) => ({ ...prev, isArchive: false }));
  }, []);

  // Smart navigation
  const navigateToTask = useCallback((taskId: string, parentId?: string) => {
    setLayout((prev) => {
      if (parentId) {
        // It's a subtask — focus on parent + select subtask
        if (prev.taskId === parentId) {
          // Parent already focused — just add subtask selection (preserve other state)
          return { ...prev, preset: "Subtask", subtaskId: taskId };
        }
        // Different parent or no focus — open parent + subtask
        return {
          preset: "Subtask",
          isArchive: prev.isArchive,
          taskId: parentId,
          subtaskId: taskId,
          commitHash: null,
        };
      }

      // It's a top-level task
      if (prev.taskId === taskId) {
        // Already focused on this task — no-op (preserve other state)
        return prev;
      }
      // Different task — clean focus switch
      return {
        preset: "Task",
        isArchive: prev.isArchive,
        taskId,
        subtaskId: null,
        commitHash: null,
      };
    });
  }, []);

  const value = useMemo<DisplayContextValue>(
    () => ({
      layout,
      activePreset,
      showBoard,
      showTask,
      showSubtask,
      showNewTask,
      showTaskDiff,
      showSubtaskDiff,
      toggleGitHistory,
      selectCommit,
      deselectCommit,
      toggleAssistant,
      toggleAssistantHistory,
      closeFocus,
      closeSubtask,
      closeDiff,
      closeAssistantHistory,
      switchToArchive,
      switchToActive,
      navigateToTask,
    }),
    [
      layout,
      activePreset,
      showBoard,
      showTask,
      showSubtask,
      showNewTask,
      showTaskDiff,
      showSubtaskDiff,
      toggleGitHistory,
      selectCommit,
      deselectCommit,
      toggleAssistant,
      toggleAssistantHistory,
      closeFocus,
      closeSubtask,
      closeDiff,
      closeAssistantHistory,
      switchToArchive,
      switchToActive,
      navigateToTask,
    ],
  );

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}
