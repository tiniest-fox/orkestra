// Shared hook for session log fetching with connection-gated refresh and event-driven updates.

import { useCallback, useEffect, useState } from "react";
import { useConnectionState, useTransport } from "../transport";
import { useTransportListener } from "../transport/useTransportListener";
import type { LogEntry } from "../types/workflow";

interface UseSessionLogsResult {
  /** Current log entries for the active session. */
  logs: LogEntry[];
  /**
   * Fetch the latest logs for the session. Uses length-based comparison to avoid
   * spurious re-renders. Callers (polling callbacks) should wrap in try/catch.
   */
  fetchLogs: () => Promise<void>;
}

/**
 * Manages session log state with connection-gated fetching and event-driven refresh.
 *
 * Encapsulates three concerns shared by AssistantDrawer and task log hooks:
 * 1. Clear logs and skip fetching when sessionId is null or connection is not ready.
 * 2. Re-fetch when session changes or connection is restored.
 * 3. Immediately refresh on `log_entry_appended` events for the active session.
 */
export function useSessionLogs(sessionId: string | null): UseSessionLogsResult {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const fetchLogs = useCallback(async () => {
    if (!sessionId) return;
    const newLogs = await transport.call<LogEntry[]>("assistant_get_logs", {
      session_id: sessionId,
    });
    // Length-based comparison is correct because logs are append-only during active sessions
    // (no UPDATE/DELETE in the store while viewing). If in-place mutation is ever added, this
    // must be updated to a content-aware comparison.
    setLogs((prev) => (prev.length === newLogs.length ? prev : newLogs));
  }, [transport, sessionId]);

  // Fetch when session changes or connection is restored. Clear when session is null.
  useEffect(() => {
    if (!sessionId) {
      setLogs([]);
      return;
    }
    if (connectionState !== "connected") return;
    fetchLogs().catch(console.error);
  }, [sessionId, connectionState, fetchLogs]);

  // React immediately to new log entries pushed by the backend.
  useTransportListener<{ task_id: string; session_id: string }>("log_entry_appended", (data) => {
    if (data.session_id === sessionId) {
      fetchLogs().catch(console.error);
    }
  });

  return { logs, fetchLogs };
}
