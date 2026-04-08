/**
 * Hook for controlling the run script process and streaming its log output.
 *
 * Polls for new log lines incrementally when the process is running, and polls
 * for status when it's stopped (to detect external stops).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTransport } from "../transport";
import { extractErrorMessage } from "../utils/errors";
import { usePolling } from "./usePolling";

// ============================================================================
// Types
// ============================================================================

export interface RunStatus {
  running: boolean;
  pid: number | null;
  exit_code: number | null;
}

interface RunLogs {
  lines: string[];
  total_lines: number;
}

export interface UseRunScriptResult {
  status: RunStatus;
  lines: string[];
  loading: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

export function useRunScript(taskId: string, active: boolean): UseRunScriptResult {
  const transport = useTransport();
  const [status, setStatus] = useState<RunStatus>({
    running: false,
    pid: null,
    exit_code: null,
  });
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sinceLine tracks how many lines we've already fetched so we only poll for new ones
  const sinceLineRef = useRef(0);

  // Generation counter to detect stale async responses after taskId changes
  const generationRef = useRef(0);

  // Reset all state when taskId changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId in deps intentionally triggers reset; body uses stable refs/setters
  useEffect(() => {
    generationRef.current += 1;
    setStatus({ running: false, pid: null, exit_code: null });
    setLines([]);
    sinceLineRef.current = 0;
    setError(null);
    setLoading(false);
  }, [taskId]);

  // Fetch initial status on mount or when active becomes true
  useEffect(() => {
    if (!active || !transport.supportsLocalOperations) return;
    const gen = generationRef.current;
    transport
      .call<RunStatus>("get_run_status", { task_id: taskId })
      .then((s) => {
        if (gen !== generationRef.current) return;
        setStatus(s);
      })
      .catch(() => {});
  }, [active, taskId, transport]);

  // Poll for new log lines when running
  const fetchLogs = useCallback(async () => {
    if (!transport.supportsLocalOperations) return;
    try {
      const gen = generationRef.current;
      const result = await transport.call<RunLogs>("get_run_logs", {
        task_id: taskId,
        since_line: sinceLineRef.current,
      });
      if (gen !== generationRef.current) return;
      if (result.lines.length > 0) {
        setLines((prev) => [...prev, ...result.lines]);
      }
      sinceLineRef.current = result.total_lines;
      // Refresh status along with log poll to detect process exit
      const newStatus = await transport.call<RunStatus>("get_run_status", { task_id: taskId });
      if (gen !== generationRef.current) return;
      setStatus(newStatus);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }, [taskId, transport]);

  // Poll for status when stopped (to detect external process starts/stops)
  const fetchStatus = useCallback(async () => {
    if (!transport.supportsLocalOperations) return;
    try {
      const gen = generationRef.current;
      const newStatus = await transport.call<RunStatus>("get_run_status", { task_id: taskId });
      if (gen !== generationRef.current) return;
      setStatus(newStatus);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }, [taskId, transport]);

  const shouldPollLogs = active && status.running;
  const shouldPollStatus = active && !status.running;

  usePolling(shouldPollLogs ? fetchLogs : null, 1000);
  usePolling(shouldPollStatus ? fetchStatus : null, 2000);

  const start = useCallback(async () => {
    if (!transport.supportsLocalOperations || loading) return;
    const gen = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      await transport.call("start_run_script", { task_id: taskId });
      if (gen !== generationRef.current) return;
      // Clear previous output and reset line offset
      setLines([]);
      sinceLineRef.current = 0;
      const newStatus = await transport.call<RunStatus>("get_run_status", { task_id: taskId });
      if (gen !== generationRef.current) return;
      setStatus(newStatus);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(extractErrorMessage(e));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [taskId, loading, transport]);

  const stop = useCallback(async () => {
    if (!transport.supportsLocalOperations || loading) return;
    const gen = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      await transport.call("stop_run_script", { task_id: taskId });
      if (gen !== generationRef.current) return;
      // Fetch any remaining output after stop
      const result = await transport.call<RunLogs>("get_run_logs", {
        task_id: taskId,
        since_line: sinceLineRef.current,
      });
      if (gen !== generationRef.current) return;
      if (result.lines.length > 0) {
        setLines((prev) => [...prev, ...result.lines]);
      }
      sinceLineRef.current = result.total_lines;
      const newStatus = await transport.call<RunStatus>("get_run_status", { task_id: taskId });
      if (gen !== generationRef.current) return;
      setStatus(newStatus);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(extractErrorMessage(e));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [taskId, loading, transport]);

  return { status, lines, loading, error, start, stop };
}
