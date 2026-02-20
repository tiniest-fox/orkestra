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
import { usePolling } from "../hooks/usePolling";
import type {
  AssistantSession,
  LogEntry,
  WorkflowQuestion,
  WorkflowQuestionAnswer,
} from "../types/workflow";
import { parseAssistantQuestions } from "../utils/assistantQuestions";

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
  /** Whether there's an unread response (agent finished while panel was closed). */
  hasUnreadResponse: boolean;
  /** Pending questions detected from assistant output. */
  pendingQuestions: WorkflowQuestion[];
  /** Submit answers to pending questions. */
  answerQuestions: (answers: WorkflowQuestionAnswer[]) => Promise<void>;
  /** Whether answer submission is in progress. */
  isAnswering: boolean;
  /** Send a message (creates new session or resumes existing). */
  sendMessage: (message: string) => Promise<void>;
  /** Stop the running agent process. */
  stopAgent: () => Promise<void>;
  /** Clear the current session and prepare for a new one. */
  newSession: () => Promise<void>;
  /** Select a session from history. */
  selectSession: (session: AssistantSession) => Promise<void>;
  /** Mark the panel as open or closed. */
  markPanelOpen: (open: boolean) => void;
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

/**
 * Format question answers as a plaintext message.
 *
 * IMPORTANT: This format must match the "Answer format" section in
 * crates/orkestra-core/src/prompts/templates/assistant/system_prompt.md (lines 169-178).
 * Changes to this format require updating the system prompt.
 */
function formatAnswerMessage(answers: WorkflowQuestionAnswer[]): string {
  const lines = answers.map((a, i) => `${i + 1}. ${a.question}\n   Answer: ${a.answer}`);
  return `Here are my answers to your questions:\n\n${lines.join("\n\n")}`;
}

export function AssistantProvider({ children }: AssistantProviderProps) {
  const [activeSession, setActiveSession] = useState<AssistantSession | null>(null);
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [hasUnreadResponse, setHasUnreadResponse] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<WorkflowQuestion[]>([]);
  const [isAnswering, setIsAnswering] = useState(false);

  // Track active session in a ref for race condition protection
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;

  // Track panel open state for unread detection
  const isPanelOpenRef = useRef(false);

  // Track agent working state for completion detection
  const isAgentWorkingRef = useRef(false);
  isAgentWorkingRef.current = isAgentWorking;

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
        // Check for agent completion (only if agent was actually working)
        const lastEntry = result[result.length - 1];
        if (lastEntry?.type === "process_exit" && isAgentWorkingRef.current) {
          // Detect questions BEFORE setting isAgentWorking to false
          const questions = parseAssistantQuestions(result);

          // Batch state updates — React batches these into one render
          if (questions.length > 0) {
            setPendingQuestions(questions);
          }
          setIsAgentWorking(false);

          // Flag unread if panel is not open
          if (!isPanelOpenRef.current) {
            setHasUnreadResponse(true);
          }
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

  // Mark panel as open or closed
  const markPanelOpen = useCallback((open: boolean) => {
    isPanelOpenRef.current = open;
    if (open) {
      setHasUnreadResponse(false);
    }
  }, []);

  // Wrapper to poll logs for the active session (uses existing activeSessionIdRef)
  const fetchLogsForActiveSession = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    if (sessionId) await fetchLogs(sessionId);
  }, [fetchLogs]);

  // Poll logs while agent is working and a session is active
  usePolling(isAgentWorking && activeSession?.id ? fetchLogsForActiveSession : null, 2000);

  // Poll sessions list while agent is working (detects title updates)
  usePolling(isAgentWorking ? fetchSessions : null, 2000);

  // Load sessions on mount
  useEffect(() => {
    fetchSessions().finally(() => setIsLoading(false));
  }, [fetchSessions]);

  /**
   * Send a message to the assistant and track the session state.
   * Throws on failure (caller adds error logs).
   */
  const sendAndTrack = useCallback(
    async (sessionId: string | null, message: string): Promise<void> => {
      const session = await invoke<AssistantSession>("assistant_send_message", {
        sessionId,
        message,
      });
      setActiveSession(session);
      setIsAgentWorking(true);
      // Fetch initial logs immediately
      await fetchLogs(session.id);
      // Refresh sessions list to include the new session
      await fetchSessions();
    },
    [fetchLogs, fetchSessions],
  );

  // Send a message
  const sendMessage = useCallback(
    async (message: string) => {
      try {
        await sendAndTrack(activeSession?.id ?? null, message);
      } catch (err) {
        console.error("Failed to send message:", err);
        // Add error entry to logs
        setLogs((prev) => [...prev, { type: "error", message: `Failed to send message: ${err}` }]);
      }
    },
    [activeSession?.id, sendAndTrack],
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

  // Answer pending questions
  const answerQuestions = useCallback(
    async (answers: WorkflowQuestionAnswer[]) => {
      if (!activeSession?.id) return;

      setIsAnswering(true);
      try {
        // Format answers as plaintext message
        const message = formatAnswerMessage(answers);
        await sendAndTrack(activeSession.id, message);
        // Only clear questions on success
        setPendingQuestions([]);
      } catch (err) {
        console.error("Failed to submit answers:", err);
        // Add error entry to logs
        setLogs((prev) => [
          ...prev,
          { type: "error", message: `Failed to submit answers: ${err}` },
        ]);
        // Don't clear pendingQuestions — keep form visible for retry
      } finally {
        setIsAnswering(false);
      }
    },
    [activeSession?.id, sendAndTrack],
  );

  // Start a new session
  const newSession = useCallback(async () => {
    // Stop current agent if running
    if (isAgentWorking) {
      await stopAgent();
    }
    // Clear state
    setActiveSession(null);
    setLogs([]);
    setPendingQuestions([]);
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
      setPendingQuestions([]);
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
    hasUnreadResponse,
    pendingQuestions,
    answerQuestions,
    isAnswering,
    sendMessage,
    stopAgent,
    newSession,
    selectSession,
    markPanelOpen,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
