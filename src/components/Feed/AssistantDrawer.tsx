// Assistant chat drawer — project-level and task-scoped AI chat with session management.

import { History, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { usePolling } from "../../hooks/usePolling";
import { useToast } from "../../providers/ToastProvider";
import { useTransport } from "../../transport";
import type { AssistantSession, LogEntry, WorkflowQuestion } from "../../types/workflow";
import { parseAssistantQuestions } from "../../utils/assistantQuestions";
import { relativeTime } from "../../utils/relativeTime";
import { isDisconnectError } from "../../utils/transportErrors";
import { Drawer } from "../ui/Drawer/Drawer";
import { type DrawerAction, DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { ChatComposeArea } from "./ChatComposeArea";
import { buildDisplayMessages, MessageList } from "./MessageList";
import { QuestionCard } from "./QuestionCard";

// ============================================================================
// AssistantDrawer
// ============================================================================

const PLUS_ICON = <Plus />;
const HISTORY_ICON = <History />;

interface AssistantDrawerProps {
  onClose: () => void;
  /** When provided, renders a back-arrow in the header (e.g. return to task drawer). */
  onBack?: () => void;
  /** When set, operates in task mode — scoped to this task's assistant session. */
  taskId?: string;
}

export function AssistantDrawer({ onClose, onBack, taskId }: AssistantDrawerProps) {
  const transport = useTransport();
  const { showError } = useToast();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);

  const { containerRef: messageListRef, handleScroll } = useAutoScroll<HTMLDivElement>(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const isAgentRunning = activeSession?.agent_pid != null;

  const questions: WorkflowQuestion[] = useMemo(() => parseAssistantQuestions(logs), [logs]);

  // Reset answers when question count changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on question count change
  useEffect(() => {
    setAnswers(questions.map(() => ""));
  }, [questions.length]);

  // -- Fetch sessions on mount and auto-select --
  useEffect(() => {
    if (taskId) {
      // Task mode: find the existing session for this task, if any.
      transport
        .call<AssistantSession[]>("assistant_list_sessions", {})
        .then((fetched) => {
          const taskSession = fetched.find((s) => s.task_id === taskId);
          if (taskSession) {
            setSessions([taskSession]);
            setActiveSessionId(taskSession.id);
          }
          // If no session found, first message will create one.
        })
        .catch(console.error);
    } else {
      // Project mode: use the project-only list (excludes task sessions).
      transport
        .call<AssistantSession[]>("assistant_list_project_sessions", {})
        .then((fetched) => {
          setSessions(fetched);
          if (fetched.length > 0) {
            setActiveSessionId(fetched[0].id);
          }
        })
        .catch(console.error);
    }
  }, [transport, taskId]);

  // -- Fetch logs when session changes --
  useEffect(() => {
    if (!activeSessionId) {
      setLogs([]);
      return;
    }
    transport
      .call<LogEntry[]>("assistant_get_logs", { session_id: activeSessionId })
      .then(setLogs)
      .catch(console.error);
  }, [transport, activeSessionId]);

  // -- Fetch the active task session by session ID (task mode only) --
  const fetchTaskSession = useCallback(async (): Promise<AssistantSession | undefined> => {
    const allSessions = await transport.call<AssistantSession[]>("assistant_list_sessions", {});
    return allSessions.find((s) => s.id === activeSessionId);
  }, [transport, activeSessionId]);

  // -- Poll logs while agent is running --
  const fetchLogs = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const newLogs = await transport.call<LogEntry[]>("assistant_get_logs", {
        session_id: activeSessionId,
      });
      setLogs((prev) => (JSON.stringify(prev) === JSON.stringify(newLogs) ? prev : newLogs));
      if (taskId) {
        // Task mode: update just the task's session to track agent_pid.
        const taskSession = await fetchTaskSession();
        if (taskSession) {
          setSessions((prev) => {
            const old = prev[0];
            if (old && old.agent_pid === taskSession.agent_pid && old.title === taskSession.title)
              return prev;
            return [taskSession];
          });
        }
      } else {
        const updatedSessions = await transport.call<AssistantSession[]>(
          "assistant_list_project_sessions",
          {},
        );
        setSessions((prev) => {
          if (prev.length !== updatedSessions.length) return updatedSessions;
          const changed = updatedSessions.some(
            (s, i) =>
              s.agent_pid !== prev[i]?.agent_pid ||
              s.title !== prev[i]?.title ||
              s.id !== prev[i]?.id,
          );
          return changed ? updatedSessions : prev;
        });
      }
    } catch (err) {
      if (!isDisconnectError(err)) console.error(err);
    }
  }, [transport, activeSessionId, taskId, fetchTaskSession]);

  usePolling(isAgentRunning ? fetchLogs : null, 1000);

  // -- Escape closes session list before panel --
  useEffect(() => {
    if (!showSessionList) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSessionList(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSessionList]);

  // -- Session switch --
  const handleSwitchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setShowSessionList(false);
    setInputValue("");
  }, []);

  // -- Shared send + refresh helper --
  const sendAndRefresh = useCallback(
    async (message: string) => {
      let session: AssistantSession;
      if (taskId) {
        session = await transport.call<AssistantSession>("assistant_send_task_message", {
          task_id: taskId,
          message,
        });
        setActiveSessionId(session.id);
        setSessions([session]);
        const newLogs = await transport.call<LogEntry[]>("assistant_get_logs", {
          session_id: session.id,
        });
        setLogs(newLogs);
      } else {
        session = await transport.call<AssistantSession>("assistant_send_message", {
          session_id: activeSessionId,
          message,
        });
        setActiveSessionId(session.id);
        const [updatedSessions, newLogs] = await Promise.all([
          transport.call<AssistantSession[]>("assistant_list_project_sessions", {}),
          transport.call<LogEntry[]>("assistant_get_logs", { session_id: session.id }),
        ]);
        setSessions(updatedSessions);
        setLogs(newLogs);
      }
    },
    [transport, activeSessionId, taskId],
  );

  // -- Send message --
  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg || sending) return;
    setSending(true);
    setInputValue("");
    try {
      await sendAndRefresh(msg);
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, sendAndRefresh]);

  // -- Send question answers --
  const handleSendAnswers = useCallback(async () => {
    if (sending || answers.every((a) => !a.trim())) return;
    const formatted = questions
      .map((q, i) => `**${q.question}**\n${answers[i] ?? ""}`)
      .join("\n\n");
    setSending(true);
    try {
      await sendAndRefresh(formatted);
    } catch (err) {
      console.error("Failed to send answers:", err);
    } finally {
      setSending(false);
    }
  }, [sending, questions, answers, sendAndRefresh]);

  // -- Stop agent --
  const handleStop = useCallback(async () => {
    if (!activeSessionId) return;
    await transport.call("assistant_stop", { session_id: activeSessionId }).catch((err) => {
      if (!isDisconnectError(err)) showError(String(err));
    });
    if (taskId) {
      const taskSession = await fetchTaskSession();
      if (taskSession) setSessions([taskSession]);
    } else {
      const updatedSessions = await transport.call<AssistantSession[]>(
        "assistant_list_project_sessions",
        {},
      );
      setSessions(updatedSessions);
    }
  }, [transport, activeSessionId, taskId, fetchTaskSession, showError]);

  // -- New session --
  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setLogs([]);
    setShowSessionList(false);
    setInputValue("");
  }, []);

  const displayMessages = useMemo(() => buildDisplayMessages(logs), [logs]);
  const sessionTitle = activeSession?.title ?? null;

  const headerActions = useMemo<DrawerAction[]>(
    () =>
      taskId
        ? []
        : [
            ...(activeSessionId !== null
              ? [
                  {
                    icon: PLUS_ICON,
                    label: "New session",
                    shortLabel: "New",
                    onClick: handleNewSession,
                  },
                ]
              : []),
            {
              icon: HISTORY_ICON,
              label: "Sessions",
              shortLabel: "Sessions",
              onClick: () => setShowSessionList(true),
            },
          ],
    [taskId, activeSessionId, handleNewSession],
  );

  const titleNode = useMemo(
    () => (
      <span className="flex items-center gap-2.5">
        <span>{taskId ? "Trak Assistant" : "Assistant"}</span>
        {sessionTitle && (
          <>
            <span className="text-border select-none">/</span>
            <span className="font-mono text-[11px] font-normal text-text-tertiary truncate">
              {sessionTitle}
            </span>
          </>
        )}
      </span>
    ),
    [taskId, sessionTitle],
  );

  const answerChangeHandlers = useMemo(
    () =>
      questions.map(
        (_, qi) => (v: string) =>
          setAnswers((prev) => {
            const next = [...prev];
            next[qi] = v;
            return next;
          }),
      ),
    [questions],
  );

  const lastAgentExtra = useMemo(
    () =>
      questions.length > 0 ? (
        <div className="mt-4 pt-4 border-t border-border -mx-6 px-0">
          {questions.map((q, qi) => (
            <QuestionCard
              // biome-ignore lint/suspicious/noArrayIndexKey: questions lack stable IDs
              key={`q-${qi}`}
              index={qi}
              question={q}
              value={answers[qi] ?? ""}
              onChange={answerChangeHandlers[qi]}
              flatStartIndex={qi}
              keyboardFlatIdx={-1}
            />
          ))}
          <div className="px-6 pb-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSendAnswers}
              disabled={sending || answers.every((a) => !a.trim())}
              className="font-sans text-[12px] font-semibold px-3.5 py-1.5 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send answers
            </button>
          </div>
        </div>
      ) : undefined,
    [questions, answers, answerChangeHandlers, sending, handleSendAnswers],
  );

  return (
    <Drawer onClose={onClose} disableEscape={showSessionList}>
      <HotkeyScope active>
        <div className="flex flex-col h-full relative overflow-hidden">
          <DrawerHeader
            title={titleNode}
            onClose={onClose}
            onBack={onBack}
            actions={headerActions}
          />

          {/* Message List */}
          <MessageList
            messages={displayMessages}
            isAgentRunning={isAgentRunning}
            agentLabel="Assistant"
            containerRef={messageListRef}
            onScroll={handleScroll}
            emptyText="Start a conversation with the assistant."
            lastAgentExtra={lastAgentExtra}
          />

          {/* Compose Area */}
          <ChatComposeArea
            value={inputValue}
            onChange={setInputValue}
            textareaRef={textareaRef}
            sending={sending}
            agentActive={isAgentRunning}
            onSend={handleSend}
            onStop={handleStop}
            placeholder="Ask the assistant…"
            className="shrink-0 px-4 pt-2 pb-4 bg-canvas"
          />

          {/* Session List Overlay — slides in from right (project mode only) */}
          <div
            className={[
              "absolute inset-0 bg-surface z-20 flex flex-col transition-transform duration-[160ms] ease-out",
              !taskId && showSessionList ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
          >
            <DrawerHeader
              title="Sessions"
              onClose={onClose}
              onBack={() => setShowSessionList(false)}
              actions={[
                {
                  icon: <Plus />,
                  label: "New session",
                  shortLabel: "New",
                  onClick: handleNewSession,
                },
              ]}
            />
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 && (
                <div className="p-4 font-mono text-[11px] text-text-quaternary">
                  No sessions yet.
                </div>
              )}
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => handleSwitchSession(session.id)}
                  onKeyDown={() => {}}
                  className={[
                    "w-full text-left px-4 py-2.5 border-b border-border border-l-2 transition-colors",
                    session.id === activeSessionId
                      ? "border-l-accent bg-accent-soft"
                      : "border-l-transparent hover:bg-canvas",
                  ].join(" ")}
                >
                  <div className="font-sans text-[12px] font-medium text-text-primary truncate">
                    {session.title ?? "Untitled session"}
                  </div>
                  <div className="font-mono text-[10px] text-text-tertiary mt-0.5">
                    {relativeTime(session.updated_at)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </HotkeyScope>
    </Drawer>
  );
}
