//! Assistant chat drawer — project-level and task-scoped AI chat with session management.

import { ArrowLeft, ArrowUp, History, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { useIsMobile } from "../../hooks/useIsMobile";
import { usePolling } from "../../hooks/usePolling";
import { useTransport } from "../../transport";
import type { AssistantSession, LogEntry, WorkflowQuestion } from "../../types/workflow";
import { parseAssistantQuestions, stripQuestionBlocks } from "../../utils/assistantQuestions";
import { stripParameterBlocks } from "../../utils/feedContent";
import { PROSE_CLASSES } from "../../utils/prose";
import { relativeTime } from "../../utils/relativeTime";
import { toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer/Drawer";
import { type DrawerAction, DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { ErrorLine, ScriptOutputLine, ToolLine } from "./FeedEntryComponents";
import { QuestionCard } from "./QuestionCard";

// ============================================================================
// Helpers
// ============================================================================

export interface UserMessage {
  kind: "user";
  content: string;
}

export interface AgentMessage {
  kind: "agent";
  entries: LogEntry[];
}

export type DisplayMessage = UserMessage | AgentMessage;

export function buildDisplayMessages(logs: LogEntry[]): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  let agentEntries: LogEntry[] = [];

  for (const entry of logs) {
    if (entry.type === "user_message") {
      if (agentEntries.length > 0) {
        messages.push({ kind: "agent", entries: agentEntries });
        agentEntries = [];
      }
      messages.push({ kind: "user", content: entry.content });
    } else {
      agentEntries.push(entry);
    }
  }

  if (agentEntries.length > 0) {
    messages.push({ kind: "agent", entries: agentEntries });
  }

  return messages;
}

// ============================================================================
// Entry components
// ============================================================================

function AssistantTextLine({ content }: { content: string }) {
  const cleaned = stripQuestionBlocks(stripParameterBlocks(content));
  if (!cleaned) return null;
  return (
    <div className={`text-forge-body py-3 ${PROSE_CLASSES}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}

export function AgentEntry({ entry }: { entry: GroupedLogEntry }) {
  if (entry.type === "subagent_group") {
    const toolCalls = entry.subagentEntries.filter((s) => s.type === "subagent_tool_use");
    const shown = toolCalls.slice(-2);
    const hidden = toolCalls.length - shown.length;
    return (
      <>
        <ToolLine
          label="Agent"
          summary={
            entry.taskEntry.input.tool === "agent"
              ? ((entry.taskEntry.input as { description?: string }).description ?? "")
              : ""
          }
          variant="task"
        />
        <div className="ml-[2px] pl-4 border-l border-border">
          {hidden > 0 && (
            <div className="font-mono text-forge-mono-sm text-text-quaternary py-[3px]">
              +{hidden} tool call{hidden !== 1 ? "s" : ""}
            </div>
          )}
          {shown.map((sub, i) =>
            sub.type === "subagent_tool_use" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable ID
              <ToolLine key={i} label={sub.tool} summary={toolSummary(sub.input)} variant="tool" />
            ) : null,
          )}
        </div>
      </>
    );
  }

  switch (entry.type) {
    case "text":
      return <AssistantTextLine content={entry.content} />;

    case "tool_use":
      return <ToolLine label={entry.tool} summary={toolSummary(entry.input)} variant="tool" />;

    case "error":
      return <ErrorLine message={entry.message} />;

    case "script_start":
      return <ToolLine label={`sh · ${entry.stage}`} summary={entry.command} variant="script" />;

    case "script_output":
      return <ScriptOutputLine content={entry.content} />;

    case "script_exit":
      return (
        <div
          className={`font-mono text-forge-mono-sm py-0.5 ${entry.success ? "text-text-quaternary" : "text-status-error"}`}
        >
          {entry.success
            ? "✓ done"
            : `✗ exit ${entry.code}${entry.timed_out ? " (timed out)" : ""}`}
        </div>
      );

    case "user_message":
    case "tool_result":
    case "subagent_tool_use":
    case "subagent_tool_result":
    case "process_exit":
      return null;

    default:
      return null;
  }
}

function AgentEntries({ entries }: { entries: LogEntry[] }) {
  const grouped = useGroupedLogs(entries);
  return (
    <>
      {grouped.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: no stable IDs on log entries
        <AgentEntry key={i} entry={entry} />
      ))}
    </>
  );
}

// ============================================================================
// AssistantDrawer
// ============================================================================

interface AssistantDrawerProps {
  onClose: () => void;
  /** When set, operates in task mode — scoped to this task's assistant session. */
  taskId?: string;
}

export function AssistantDrawer({ onClose, taskId }: AssistantDrawerProps) {
  const transport = useTransport();
  const isMobile = useIsMobile();
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
    const newLogs = await transport.call<LogEntry[]>("assistant_get_logs", {
      session_id: activeSessionId,
    });
    setLogs(newLogs);
    if (taskId) {
      // Task mode: update just the task's session to track agent_pid.
      const taskSession = await fetchTaskSession();
      if (taskSession) setSessions([taskSession]);
    } else {
      const updatedSessions = await transport.call<AssistantSession[]>(
        "assistant_list_project_sessions",
        {},
      );
      setSessions(updatedSessions);
    }
  }, [transport, activeSessionId, taskId, fetchTaskSession]);

  usePolling(isAgentRunning ? fetchLogs : null, 1000);

  // -- Textarea auto-resize --
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputValue is the intentional resize trigger
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputValue]);

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
    await transport.call("assistant_stop", { session_id: activeSessionId }).catch(console.error);
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
  }, [transport, activeSessionId, taskId, fetchTaskSession]);

  // -- New session --
  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setLogs([]);
    setShowSessionList(false);
    setInputValue("");
  }, []);

  // -- Textarea keydown: Cmd+Enter to send, Cmd+. to stop --
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "." && e.metaKey && isAgentRunning) {
      e.preventDefault();
      handleStop();
    }
  }

  const displayMessages = buildDisplayMessages(logs);
  const sessionTitle = activeSession?.title ?? null;

  const headerActions: DrawerAction[] = taskId
    ? []
    : [
        ...(activeSessionId !== null
          ? [{ icon: <Plus />, label: "New session", shortLabel: "New", onClick: handleNewSession }]
          : []),
        {
          icon: <History />,
          label: "Sessions",
          shortLabel: "Sessions",
          onClick: () => setShowSessionList(true),
        },
      ];

  return (
    <Drawer onClose={onClose} disableEscape={showSessionList}>
      <HotkeyScope active>
        <div className="flex flex-col h-full relative overflow-hidden">
          <DrawerHeader
            title={
              <span className="flex items-center gap-2.5">
                <span>{taskId ? "Task Assistant" : "Assistant"}</span>
                {sessionTitle && (
                  <>
                    <span className="text-border select-none">/</span>
                    <span className="font-mono text-[11px] font-normal text-text-tertiary truncate">
                      {sessionTitle}
                    </span>
                  </>
                )}
              </span>
            }
            onClose={onClose}
            actions={headerActions}
          />

          {/* Message List */}
          <div
            ref={messageListRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto bg-canvas"
          >
            {displayMessages.length === 0 && !isAgentRunning && (
              <div className="flex items-center justify-center h-full">
                <p className="font-mono text-[11px] text-text-quaternary">
                  Start a conversation with the assistant.
                </p>
              </div>
            )}
            {displayMessages.map((msg, i) => {
              // Detect the last agent message — questions attach below it
              const isLastAgent =
                msg.kind === "agent" &&
                displayMessages.slice(i + 1).every((m) => m.kind !== "agent");

              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: display messages have no stable IDs
                  key={`msg-${i}`}
                  className={[
                    "border-b border-border last:border-b-0",
                    msg.kind === "user"
                      ? "border-l-2 border-l-accent bg-surface px-6 py-3.5 pl-[22px]"
                      : "bg-canvas px-6 py-3.5",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "font-mono text-[10px] font-medium uppercase tracking-wider mb-1.5",
                      msg.kind === "user" ? "text-accent" : "text-text-tertiary",
                    ].join(" ")}
                  >
                    {msg.kind === "user" ? "You" : "Assistant"}
                  </div>
                  {msg.kind === "agent" ? (
                    <div className="text-text-secondary">
                      <AgentEntries entries={msg.entries} />
                    </div>
                  ) : (
                    <div className="font-sans text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  )}

                  {/* Question cards on the last agent message */}
                  {isLastAgent && questions.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border -mx-6 px-0">
                      {questions.map((q, qi) => (
                        <QuestionCard
                          // biome-ignore lint/suspicious/noArrayIndexKey: questions lack stable IDs
                          key={`q-${qi}`}
                          index={qi}
                          question={q}
                          value={answers[qi] ?? ""}
                          onChange={(v) =>
                            setAnswers((prev) => {
                              const next = [...prev];
                              next[qi] = v;
                              return next;
                            })
                          }
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
                  )}
                </div>
              );
            })}

            {/* Spinner shown while agent is working */}
            {isAgentRunning && (
              <div className="flex items-center gap-2 px-6 py-3.5 text-text-quaternary">
                <span className="w-3.5 h-3.5 border-2 border-border border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="font-mono text-[11px]">Working…</span>
              </div>
            )}
          </div>

          {/* Compose Area */}
          <div className="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] bg-canvas">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAgentRunning || sending}
                placeholder={isAgentRunning ? "Assistant is responding…" : "Ask the assistant…"}
                rows={1}
                className="flex-1 font-sans text-[13px] bg-surface border border-border rounded-xl px-3.5 py-2.5 outline-none resize-none overflow-hidden text-text-primary placeholder:text-text-quaternary focus:border-text-quaternary transition-colors leading-relaxed disabled:opacity-40 min-h-[42px] max-h-[120px]"
              />
              {isAgentRunning ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop"
                  className={`shrink-0 h-10 rounded-full bg-status-warning hover:opacity-90 flex items-center justify-center text-white transition-opacity gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
                >
                  <Square size={13} fill="currentColor" />
                  {!isMobile && (
                    <span className="font-mono text-[11px] font-semibold">
                      Stop
                      <span className="opacity-60 ml-1.5">⌘.</span>
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || sending}
                  aria-label="Send"
                  className={`shrink-0 h-10 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center text-white transition-colors disabled:opacity-30 gap-1.5 ${isMobile ? "w-10" : "px-4"}`}
                >
                  <ArrowUp size={15} />
                  {!isMobile && (
                    <span className="font-mono text-[11px] font-semibold">
                      Send
                      <span className="opacity-60 ml-1.5">⌘↵</span>
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Session List Overlay — slides in from right (project mode only) */}
          <div
            className={[
              "absolute inset-0 bg-surface z-20 flex flex-col transition-transform duration-[160ms] ease-out",
              !taskId && showSessionList ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
          >
            <div className="shrink-0 flex items-center px-6 h-11 border-b border-border">
              <button
                type="button"
                onClick={() => setShowSessionList(false)}
                className="flex items-center gap-1 font-mono text-[11px] text-text-tertiary hover:text-text-secondary transition-colors mr-auto"
              >
                <ArrowLeft size={12} />
                Back
              </button>
              <span className="font-sans text-[13px] font-semibold text-text-primary absolute left-1/2 -translate-x-1/2">
                Sessions
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-3 border-b border-border">
                <Button
                  variant="secondary"
                  size="sm"
                  hotkey="n"
                  onClick={handleNewSession}
                  fullWidth
                >
                  New Session
                </Button>
              </div>
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
