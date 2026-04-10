/**
 * Hook for fetching and managing session logs with cursor-based incremental fetching.
 *
 * Stage presence comes from the task view's derived.stages_with_logs (synchronous).
 * Log content is fetched asynchronously on-demand, appending only new entries on each poll.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectionState, useTransport, useTransportListener } from "../transport";
import type { LogEntry, LogPage, StageLogInfo, WorkflowTaskView } from "../types/workflow";
import { isDisconnectError } from "../utils/transportErrors";
import { usePageVisibility } from "./usePageVisibility";
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
  const transport = useTransport();
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

  // Cursor tracking for incremental fetching — resets when stage/session changes
  const cursorRef = useRef<number | null>(null);

  // Clear stale logs and cursor immediately when stage or session changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional triggers, not values used inside
  useEffect(() => {
    setLogs([]);
    setError(null);
    cursorRef.current = null;
  }, [activeLogStage, activeSessionId]);

  // Track activeLogStage and activeSessionId in refs for race condition protection
  const activeLogStageRef = useRef(activeLogStage);
  activeLogStageRef.current = activeLogStage;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Fetch logs for active stage with cursor-based incremental fetching
  const fetchLogs = useCallback(async () => {
    if (!activeLogStage) return;

    const stageToFetch = activeLogStage;
    const sessionToFetch = activeSessionId;
    const cursorToFetch = cursorRef.current ?? 0;

    setIsLoading(true);
    setError(null);
    try {
      const result = await transport.call<LogPage>("get_logs", {
        task_id: task.id,
        stage: stageToFetch,
        session_id: sessionToFetch,
        cursor: cursorToFetch,
      });
      // Only update state if the stage/session hasn't changed during the fetch
      if (
        activeLogStageRef.current === stageToFetch &&
        activeSessionIdRef.current === sessionToFetch
      ) {
        if (result.entries.length > 0) {
          cursorRef.current = result.cursor;
          setLogs((prev) => [...prev, ...result.entries]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      if (
        activeLogStageRef.current === stageToFetch &&
        activeSessionIdRef.current === sessionToFetch
      ) {
        if (!isDisconnectError(err)) {
          setLogs([]);
          setError(err);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [transport, task.id, activeLogStage, activeSessionId]);

  const isVisible = usePageVisibility();
  const connectionState = useConnectionState();

  // Fetch logs when stage/session changes (handles non-polling cases and initial load).
  // connectionState dependency handles reconnection: triggers a fetch with the saved cursor,
  // which catches up on missed entries.
  useEffect(() => {
    if (!isActive || !activeLogStage || !isVisible || connectionState !== "connected") return;
    fetchLogs();
  }, [isActive, activeLogStage, isVisible, connectionState, fetchLogs]);

  // Poll while agent is running on the current stage, or during chat mode
  const shouldPoll =
    isActive &&
    isVisible &&
    connectionState === "connected" &&
    !!activeLogStage &&
    (task.derived.is_working || !!isChatting) &&
    activeLogStage === task.derived.current_stage &&
    !error;

  const { reset } = usePolling(shouldPoll ? fetchLogs : null, 2000);

  // Debounce timer ref — cleared and reset on each push event to coalesce rapid notifications.
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push subscription: react to log_entry_appended events and trigger an immediate fetch.
  // Filters to the currently active task/session so events for other tasks are ignored.
  useTransportListener<{ task_id: string; session_id: string }>(
    "log_entry_appended",
    useCallback(
      (data) => {
        if (data.task_id !== task.id) return;
        if (data.session_id !== activeSessionIdRef.current) return;

        // Debounce: cancel any pending trigger, schedule a new one after 100ms.
        if (pushTimeoutRef.current !== null) clearTimeout(pushTimeoutRef.current);
        pushTimeoutRef.current = setTimeout(() => {
          pushTimeoutRef.current = null;
          reset();
        }, 100);
      },
      [task.id, reset],
    ),
  );

  // Clean up debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (pushTimeoutRef.current !== null) clearTimeout(pushTimeoutRef.current);
    };
  }, []);

  return {
    logs,
    isLoading,
    error,
    stagesWithLogs,
    activeLogStage,
    activeSessionId,
  };
}
