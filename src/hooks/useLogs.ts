/**
 * Hook for fetching and managing session logs.
 *
 * Stage presence comes from the task view's derived.stages_with_logs (synchronous).
 * Log content is fetched asynchronously on-demand.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, StageLogInfo, WorkflowTaskView } from "../types/workflow";
import { useSmartDefault } from "./useSmartDefault";

interface UseLogsResult {
  /** Current log entries. */
  logs: LogEntry[];
  /** Whether logs are currently loading. */
  isLoading: boolean;
  /** Error if loading failed. */
  error: unknown;
  /** Stages that have logs available (with session info). */
  stagesWithLogs: StageLogInfo[];
  /** Currently selected stage. */
  activeLogStage: string | null;
  /** Currently selected session ID within the stage. */
  activeSessionId: string | null;
  /** Set the active log stage (selects the current session by default). */
  setActiveLogStage: (stage: string | null) => void;
  /** Set the active session ID directly (for sub-tab selection). */
  setActiveSessionId: (sessionId: string | null) => void;
  /** Clear error state. */
  clearError: () => void;
  /** Reset all state (for task changes). */
  reset: () => void;
}

export function useLogs(task: WorkflowTaskView, isActive: boolean): UseLogsResult {
  // Stages with logs come from the task view — no async fetch needed
  const stagesWithLogs = task.derived.stages_with_logs;

  // Extract just the stage names for useSmartDefault
  const stageNames = useMemo(() => stagesWithLogs.map((s) => s.stage), [stagesWithLogs]);

  const { selectedItem: activeLogStage, setSelectedItem: setActiveLogStageInternal } =
    useSmartDefault({
      taskId: task.id,
      currentStage: task.derived.current_stage,
      availableItems: stageNames,
      isActive,
    });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  // Start loading if we have an initial stage selected (fetch will fire on mount)
  const [isLoading, setIsLoading] = useState(() => activeLogStage !== null);
  const [error, setError] = useState<unknown>(null);
  const [activeSessionId, setActiveSessionIdInternal] = useState<string | null>(null);

  // Helper to find the default session for a stage (current session, or last one)
  const findDefaultSession = useCallback(
    (stage: string): string | null => {
      const stageInfo = stagesWithLogs.find((s) => s.stage === stage);
      if (!stageInfo || stageInfo.sessions.length === 0) return null;

      // Prefer the current session, otherwise take the last one
      const currentSession = stageInfo.sessions.find((s) => s.is_current);
      return (
        currentSession?.session_id ?? stageInfo.sessions[stageInfo.sessions.length - 1].session_id
      );
    },
    [stagesWithLogs],
  );

  const setActiveLogStage = useCallback(
    (stage: string | null) => {
      setError(null);
      setLogs([]);
      if (stage !== null) {
        setIsLoading(true);
        const defaultSessionId = findDefaultSession(stage);
        setActiveSessionIdInternal(defaultSessionId);
      } else {
        setActiveSessionIdInternal(null);
      }
      setActiveLogStageInternal(stage);
    },
    [setActiveLogStageInternal, findDefaultSession],
  );

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    setError(null);
    setLogs([]);
    if (sessionId !== null) {
      setIsLoading(true);
    }
    setActiveSessionIdInternal(sessionId);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLogs([]);
    setIsLoading(false);
    setActiveSessionIdInternal(null);
  }, []);

  // Track activeLogStage and activeSessionId in refs for race condition protection
  const activeLogStageRef = useRef(activeLogStage);
  activeLogStageRef.current = activeLogStage;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Set initial session when stage is first selected by useSmartDefault
  useEffect(() => {
    if (activeLogStage && !activeSessionId) {
      const defaultSessionId = findDefaultSession(activeLogStage);
      if (defaultSessionId) {
        setActiveSessionIdInternal(defaultSessionId);
      }
    }
  }, [activeLogStage, activeSessionId, findDefaultSession]);

  // Fetch logs for active stage with race condition protection
  const fetchLogs = useCallback(async () => {
    if (!activeLogStage) return;

    const stageToFetch = activeLogStage;
    const sessionToFetch = activeSessionId;

    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<LogEntry[]>("workflow_get_logs", {
        taskId: task.id,
        stage: stageToFetch,
        sessionId: sessionToFetch,
      });
      // Only update state if the stage/session hasn't changed during the fetch
      if (
        activeLogStageRef.current === stageToFetch &&
        activeSessionIdRef.current === sessionToFetch
      ) {
        setLogs(result);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      if (
        activeLogStageRef.current === stageToFetch &&
        activeSessionIdRef.current === sessionToFetch
      ) {
        setLogs([]);
        setError(err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [task.id, activeLogStage, activeSessionId]);

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
    activeSessionId,
    setActiveLogStage,
    setActiveSessionId,
    clearError,
    reset,
  };
}
