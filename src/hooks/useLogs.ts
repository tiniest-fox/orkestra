/**
 * Hook for fetching and managing session logs.
 * Handles race condition protection, polling, and error states.
 */

import { useCallback, useEffect, useState } from "react";
import type { LogEntry, WorkflowTask } from "../types/workflow";
import { getTaskStage } from "../types/workflow";
import { useWorkflowQueries } from "./useWorkflow";

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

export function useLogs(task: WorkflowTask, isActive: boolean): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagesWithLogs, setStagesWithLogs] = useState<string[]>([]);
  const [activeLogStage, setActiveLogStageInternal] = useState<string | null>(null);

  const { getLogs, getStagesWithLogs } = useWorkflowQueries();

  const setActiveLogStage = useCallback((stage: string | null) => {
    setError(null);
    setLogs([]);
    setActiveLogStageInternal(stage);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setActiveLogStageInternal(null);
    setStagesWithLogs([]);
    setError(null);
    setLogs([]);
  }, []);

  // Fetch stages with logs when active
  useEffect(() => {
    if (!isActive) return;

    setError(null);

    const fetchStages = async () => {
      try {
        const stages = await getStagesWithLogs(task.id);
        setStagesWithLogs(stages);

        // Auto-select current stage if available, otherwise last stage
        setActiveLogStageInternal((current) => {
          if (current) return current;
          if (stages.length === 0) return null;

          const currentStage = getTaskStage(task.status);
          if (currentStage && stages.includes(currentStage)) {
            return currentStage;
          }
          return stages[stages.length - 1];
        });
      } catch (err) {
        console.error("Failed to fetch stages with logs:", err);
        setStagesWithLogs([]);
        setError("Failed to load session stages");
      }
    };

    fetchStages();
  }, [isActive, task.id, task.status, getStagesWithLogs]);

  // Fetch logs for active stage with race condition protection
  const fetchLogs = useCallback(async () => {
    if (!activeLogStage) return;

    const stageToFetch = activeLogStage;

    setIsLoading(true);
    setError(null);
    try {
      const result = await getLogs(task.id, stageToFetch);
      // Only update state if the stage hasn't changed during the fetch
      setActiveLogStageInternal((currentStage) => {
        if (currentStage === stageToFetch) {
          setLogs(result);
        }
        return currentStage;
      });
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setActiveLogStageInternal((currentStage) => {
        if (currentStage === stageToFetch) {
          setLogs([]);
          setError("Failed to load session logs");
        }
        return currentStage;
      });
    } finally {
      setIsLoading(false);
    }
  }, [task.id, activeLogStage, getLogs]);

  // Fetch logs when active and stage is selected, with polling
  useEffect(() => {
    if (!isActive || !activeLogStage) return;

    fetchLogs();

    // Poll while agent is running on current stage
    const currentStage = getTaskStage(task.status);
    const shouldPoll = task.phase === "agent_working" && activeLogStage === currentStage && !error;

    if (shouldPoll) {
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }

    return undefined;
  }, [isActive, activeLogStage, task.phase, task.status, fetchLogs, error]);

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
