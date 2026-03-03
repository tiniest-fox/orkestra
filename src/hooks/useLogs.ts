/**
 * Hook for fetching and managing session logs.
 *
 * Stage presence comes from the task view's derived.stages_with_logs (synchronous).
 * Log content is fetched asynchronously on-demand.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry, StageLogInfo, WorkflowTaskView } from "../types/workflow";
import { usePolling } from "./usePolling";

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
}

export function useLogs(
  task: WorkflowTaskView,
  isActive: boolean,
  targetStage?: string,
  isChatting?: boolean,
): UseLogsResult {
  // Stages with logs come from the task view — no async fetch needed
  const stagesWithLogs = task.derived.stages_with_logs;

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

  // Derive active stage directly from the task — no state lag on task or stage changes.
  // For terminal tasks (done, failed, blocked), current_stage is null; fall back to the
  // last stage that has logs so users can still inspect completed work.
  const activeLogStage = useMemo((): string | null => {
    if (targetStage !== undefined) return targetStage;
    if (task.derived.current_stage !== null) return task.derived.current_stage;
    if (stagesWithLogs.length > 0) return stagesWithLogs[stagesWithLogs.length - 1].stage;
    return null;
  }, [targetStage, task.derived.current_stage, stagesWithLogs]);

  // Derive session from stage — also no state lag
  const activeSessionId = useMemo(
    () => (activeLogStage ? findDefaultSession(activeLogStage) : null),
    [activeLogStage, findDefaultSession],
  );

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(() => activeLogStage !== null);
  const [error, setError] = useState<unknown>(null);

  // Clear stale logs immediately when stage or session changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional triggers, not values used inside
  useEffect(() => {
    setLogs([]);
    setError(null);
  }, [activeLogStage, activeSessionId]);

  // Track activeLogStage and activeSessionId in refs for race condition protection
  const activeLogStageRef = useRef(activeLogStage);
  activeLogStageRef.current = activeLogStage;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

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

  // Fetch logs when stage/session changes (handles non-polling cases and initial load)
  useEffect(() => {
    if (!isActive || !activeLogStage) return;
    fetchLogs();
  }, [isActive, activeLogStage, fetchLogs]);

  // Poll while agent is running on the current stage, or during chat mode
  const shouldPoll =
    isActive &&
    !!activeLogStage &&
    (task.derived.is_working || !!isChatting) &&
    activeLogStage === task.derived.current_stage &&
    !error;

  usePolling(shouldPoll ? fetchLogs : null, 2000);

  return {
    logs,
    isLoading,
    error,
    stagesWithLogs,
    activeLogStage,
    activeSessionId,
  };
}
