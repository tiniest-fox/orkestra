/**
 * Hook for fetching and managing session logs.
 *
 * Stage presence comes from the task view's derived.stages_with_logs (synchronous).
 * Log content is fetched asynchronously on-demand.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry, WorkflowTaskView } from "../types/workflow";
import { useSmartDefault } from "./useSmartDefault";

interface UseLogsResult {
  /** Current log entries. */
  logs: LogEntry[];
  /** Whether logs are currently loading. */
  isLoading: boolean;
  /** Error message if loading failed. */
  error: string | null;
  /** Stages that have logs available. */
  stagesWithLogs: string[];
  /** Currently selected stage. */
  activeLogStage: string | null;
  /** Set the active log stage. */
  setActiveLogStage: (stage: string | null) => void;
  /** Clear error state. */
  clearError: () => void;
  /** Reset all state (for task changes). */
  reset: () => void;
}

export function useLogs(task: WorkflowTaskView, isActive: boolean): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stages with logs come from the task view — no async fetch needed
  const stagesWithLogs = task.derived.stages_with_logs;

  const { selectedItem: activeLogStage, setSelectedItem: setActiveLogStageInternal } =
    useSmartDefault({
      taskId: task.id,
      currentStage: task.derived.current_stage,
      availableItems: stagesWithLogs,
      isActive,
    });

  const setActiveLogStage = useCallback(
    (stage: string | null) => {
      setError(null);
      setLogs([]);
      setActiveLogStageInternal(stage);
    },
    [setActiveLogStageInternal],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLogs([]);
  }, []);

  // Track activeLogStage in a ref for race condition protection during async fetches
  const activeLogStageRef = useRef(activeLogStage);
  activeLogStageRef.current = activeLogStage;

  // Fetch logs for active stage with race condition protection
  const fetchLogs = useCallback(async () => {
    if (!activeLogStage) return;

    const stageToFetch = activeLogStage;

    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<LogEntry[]>("workflow_get_logs", {
        taskId: task.id,
        stage: stageToFetch,
      });
      // Only update state if the stage hasn't changed during the fetch
      if (activeLogStageRef.current === stageToFetch) {
        setLogs(result);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      if (activeLogStageRef.current === stageToFetch) {
        setLogs([]);
        setError("Failed to load session logs");
      }
    } finally {
      setIsLoading(false);
    }
  }, [task.id, activeLogStage]);

  // Fetch logs when active and stage is selected, with polling
  useEffect(() => {
    if (!isActive || !activeLogStage) return;

    fetchLogs();

    // Poll while agent is running on current stage
    const shouldPoll =
      task.derived.is_working && activeLogStage === task.derived.current_stage && !error;

    if (shouldPoll) {
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }

    return undefined;
  }, [
    isActive,
    activeLogStage,
    task.derived.is_working,
    task.derived.current_stage,
    fetchLogs,
    error,
  ]);

  return {
    logs,
    isLoading,
    error,
    stagesWithLogs,
    activeLogStage,
    setActiveLogStage,
    clearError,
    reset,
  };
}
