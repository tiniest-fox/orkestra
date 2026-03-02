//! Assistant chat drawer — project-level AI chat with session management.

import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { usePolling } from "../../hooks/usePolling";
import type { AssistantSession, LogEntry, WorkflowQuestion } from "../../types/workflow";
import { parseAssistantQuestions, stripQuestionBlocks } from "../../utils/assistantQuestions";
import { PROSE_CLASSES } from "../../utils/prose";
import { relativeTime } from "../../utils/relativeTime";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer/Drawer";
import { HotkeyScope } from "../ui/HotkeyScope";
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
  content: string;
}

export type DisplayMessage = UserMessage | AgentMessage;

export function buildDisplayMessages(logs: LogEntry[]): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  let agentChunks: string[] = [];

  for (const entry of logs) {
    if (entry.type === "user_message") {
      if (agentChunks.length > 0) {
        messages.push({ kind: "agent", content: agentChunks.join("") });
        agentChunks = [];
      }
      messages.push({ kind: "user", content: entry.content });
    } else if (entry.type === "text") {
      agentChunks.push(entry.content);
    }
    // tool_use, tool_result, process_exit, error, etc. are skipped
  }

  if (agentChunks.length > 0) {
    messages.push({ kind: "agent", content: agentChunks.join("") });
  }

  return messages;
}

// ============================================================================
// AssistantDrawer
// ============================================================================

interface AssistantDrawerProps {
  onClose: () => void;
}

export function AssistantDrawer({ onClose }: AssistantDrawerProps) {
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

  // -- Fetch sessions on mount and auto-select the most recent --
  useEffect(() => {
    invoke<AssistantSession[]>("assistant_list_sessions", {})
      .then((fetched) => {
        setSessions(fetched);
        if (fetched.length > 0) {
          setActiveSessionId(fetched[0].id);
        }
      })
      .catch(console.error);
  }, []);

  // -- Fetch logs when session changes --
  useEffect(() => {
    if (!activeSessionId) {
      setLogs([]);
      return;
    }
    invoke<LogEntry[]>("assistant_get_logs", { sessionId: activeSessionId })
      .then(setLogs)
      .catch(console.error);
  }, [activeSessionId]);

  // -- Poll logs while agent is running --
  const fetchLogs = useCallback(async () => {
    if (!activeSessionId) return;
    const [newLogs, updatedSessions] = await Promise.all([
      invoke<LogEntry[]>("assistant_get_logs", { sessionId: activeSessionId }),
      invoke<AssistantSession[]>("assistant_list_sessions", {}),
    ]);
    setLogs(newLogs);
    setSessions(updatedSessions);
  }, [activeSessionId]);

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
      const session = await invoke<AssistantSession>("assistant_send_message", {
        sessionId: activeSessionId,
        message,
      });
      setActiveSessionId(session.id);
      const [updatedSessions, newLogs] = await Promise.all([
        invoke<AssistantSession[]>("assistant_list_sessions", {}),
        invoke<LogEntry[]>("assistant_get_logs", { sessionId: session.id }),
      ]);
      setSessions(updatedSessions);
      setLogs(newLogs);
    },
    [activeSessionId],
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
    await invoke("assistant_stop", { sessionId: activeSessionId }).catch(console.error);
    const updatedSessions = await invoke<AssistantSession[]>("assistant_list_sessions", {});
    setSessions(updatedSessions);
  }, [activeSessionId]);

  // -- New session --
  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setLogs([]);
    setShowSessionList(false);
    setInputValue("");
  }, []);

  // -- Textarea keydown: Cmd+Enter to send --
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const displayMessages = buildDisplayMessages(logs);
  const sessionTitle = activeSession?.title ?? null;

  return (
    <Drawer onClose={onClose} disableEscape={showSessionList}>
      <HotkeyScope active>
        <div className="flex flex-col h-full relative overflow-hidden">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-6 h-11 border-b border-border bg-surface">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="font-sans text-[13px] font-semibold text-text-primary shrink-0">
                Assistant
              </span>
              {sessionTitle && (
                <>
                  <span className="text-border shrink-0 select-none">/</span>
                  <span className="font-mono text-[11px] text-text-tertiary truncate">
                    {sessionTitle}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeSessionId !== null && (
                <Button variant="ghost" size="sm" hotkey="n" onClick={handleNewSession}>
                  New Session
                </Button>
              )}
              <Button variant="ghost" size="sm" hotkey="s" onClick={() => setShowSessionList(true)}>
                Sessions
              </Button>
              <div className="w-px h-3 bg-border" />
              <button
                type="button"
                onClick={onClose}
                className="text-text-quaternary hover:text-text-secondary transition-colors"
                title="Close (Esc)"
              >
                <X size={14} />
              </button>
            </div>
          </div>

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
                    <div className={`text-forge-body text-text-secondary ${PROSE_CLASSES}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {stripQuestionBlocks(msg.content)}
                      </ReactMarkdown>
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
          <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              placeholder={sending ? "Sending…" : "Ask the assistant…"}
              rows={1}
              className="w-full font-mono text-[12px] bg-surface-2 border border-border rounded-md px-2.5 py-2 outline-none resize-none overflow-hidden text-text-primary placeholder:text-text-quaternary focus:border-accent/40 transition-colors leading-relaxed disabled:opacity-50 min-h-[36px] max-h-[120px]"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="font-mono text-[11px] text-accent select-none">&gt;_</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-text-quaternary">⌘↵ to send</span>
                {isAgentRunning && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="font-mono text-[10px] text-status-error hover:underline transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Session List Overlay — slides in from right */}
          <div
            className={[
              "absolute inset-0 bg-surface z-20 flex flex-col transition-transform duration-[160ms] ease-out",
              showSessionList ? "translate-x-0" : "translate-x-full",
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
