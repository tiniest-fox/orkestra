/**
 * Provider for assistant chat state and commands.
 *
 * Handles message sending, agent stopping, session creation, session selection,
 * and log polling while the agent is working.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AssistantSession, LogEntry } from "../types/workflow";

interface AssistantContextValue {
  /** Currently active session (or null if none). */
  activeSession: AssistantSession | null;
  /** All sessions (ordered by creation time, most recent first). */
  sessions: AssistantSession[];
  /** Log entries for the active session. */
  logs: LogEntry[];
  /** Whether the initial data is loading. */
  isLoading: boolean;
  /** Whether the agent is currently working. */
  isAgentWorking: boolean;
  /** Send a message (creates new session or resumes existing). */
  sendMessage: (message: string) => Promise<void>;
  /** Stop the running agent process. */
  stopAgent: () => Promise<void>;
  /** Clear the current session and prepare for a new one. */
  newSession: () => Promise<void>;
  /** Select a session from history. */
  selectSession: (session: AssistantSession) => Promise<void>;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/**
 * Access assistant state and operations. Must be used within AssistantProvider.
 */
export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used within AssistantProvider");
  }
  return ctx;
}

interface AssistantProviderProps {
  children: ReactNode;
}

export function AssistantProvider({ children }: AssistantProviderProps) {
  const [activeSession, setActiveSession] = useState<AssistantSession | null>(null);
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAgentWorking, setIsAgentWorking] = useState(false);

  // Track active session in a ref for race condition protection
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;

  // Fetch sessions list
  const fetchSessions = useCallback(async () => {
    try {
      const result = await invoke<AssistantSession[]>("assistant_list_sessions");
      setSessions(result);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  }, []);

  // Fetch logs for a specific session
  const fetchLogs = useCallback(async (sessionId: string) => {
    try {
      const result = await invoke<LogEntry[]>("assistant_get_logs", { sessionId });
      // Only update if this is still the active session
      if (activeSessionIdRef.current === sessionId) {
        setLogs(result);
        // Check for agent completion
        const lastEntry = result[result.length - 1];
        if (lastEntry?.type === "process_exit") {
          setIsAgentWorking(false);
          // Refresh sessions to pick up generated title
          const updatedSessions = await invoke<AssistantSession[]>("assistant_list_sessions");
          setSessions(updatedSessions);
          const updated = updatedSessions.find((s) => s.id === sessionId);
          if (updated) {
            setActiveSession(updated);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  }, []);

  // Poll logs when agent is working
  useEffect(() => {
    if (!isAgentWorking || !activeSession?.id) return;

    const interval = setInterval(() => {
      fetchLogs(activeSession.id);
    }, 2000);

    return () => clearInterval(interval);
  }, [isAgentWorking, activeSession?.id, fetchLogs]);

  // Poll sessions list to detect title updates
  useEffect(() => {
    if (!isAgentWorking) return;

    const interval = setInterval(() => {
      fetchSessions();
    }, 2000);

    return () => clearInterval(interval);
  }, [isAgentWorking, fetchSessions]);

  // Load sessions on mount
  useEffect(() => {
    fetchSessions().finally(() => setIsLoading(false));
  }, [fetchSessions]);

  // Send a message
  const sendMessage = useCallback(
    async (message: string) => {
      try {
        const session = await invoke<AssistantSession>("assistant_send_message", {
          sessionId: activeSession?.id ?? null,
          message,
        });
        setActiveSession(session);
        setIsAgentWorking(true);
        // Fetch initial logs immediately
        await fetchLogs(session.id);
        // Refresh sessions list to include the new session
        await fetchSessions();
      } catch (err) {
        console.error("Failed to send message:", err);
        // Add error entry to logs
        setLogs((prev) => [...prev, { type: "error", message: `Failed to send message: ${err}` }]);
      }
    },
    [activeSession?.id, fetchLogs, fetchSessions],
  );

  // Stop the agent
  const stopAgent = useCallback(async () => {
    if (!activeSession?.id) return;

    try {
      await invoke("assistant_stop", { sessionId: activeSession.id });
      setIsAgentWorking(false);
      // Refresh session to update agent_pid
      await fetchSessions();
    } catch (err) {
      console.error("Failed to stop agent:", err);
    }
  }, [activeSession?.id, fetchSessions]);

  // Start a new session
  const newSession = useCallback(async () => {
    // Stop current agent if running
    if (isAgentWorking) {
      await stopAgent();
    }
    // Clear state
    setActiveSession(null);
    setLogs([]);
  }, [isAgentWorking, stopAgent]);

  // Select a session from history
  const selectSession = useCallback(
    async (session: AssistantSession) => {
      // Stop current agent if running
      if (isAgentWorking) {
        await stopAgent();
      }
      // Load session and logs
      setActiveSession(session);
      await fetchLogs(session.id);
      // Check if agent is running (based on agent_pid)
      setIsAgentWorking(session.agent_pid !== null);
    },
    [isAgentWorking, stopAgent, fetchLogs],
  );

  const value: AssistantContextValue = {
    activeSession,
    sessions,
    logs,
    isLoading,
    isAgentWorking,
    sendMessage,
    stopAgent,
    newSession,
    selectSession,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
