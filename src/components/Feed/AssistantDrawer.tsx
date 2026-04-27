// Assistant chat drawer — project-level and task-scoped AI chat with session management.

import { Archive, History, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptimisticMessage } from "../../hooks/useOptimisticMessage";
import { usePolling } from "../../hooks/usePolling";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useToast } from "../../providers/ToastProvider";
import { useConnectionState, useTransport } from "../../transport";
import type { AssistantSession, WorkflowQuestion, WorkflowTask } from "../../types/workflow";
import { confirmAction } from "../../utils/confirmAction";
import { type OrkBlock, parseOrkBlocks } from "../../utils/orkBlocks";
import { relativeTime } from "../../utils/relativeTime";
import { isDisconnectError } from "../../utils/transportErrors";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer/Drawer";
import { type DrawerAction, DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { ModalPanel } from "../ui/ModalPanel";
import { ChatComposeArea } from "./ChatComposeArea";
import { buildDisplayMessages, MessageList } from "./MessageList";
import { ProposalCard } from "./ProposalCard";
import { QuestionCard } from "./QuestionCard";

// ============================================================================
// AssistantDrawer
// ============================================================================

const PLUS_ICON = <Plus />;
const HISTORY_ICON = <History />;
const ARCHIVE_ICON = <Archive />;
const TRASH_ICON = <Trash2 />;

interface AssistantDrawerProps {
  onClose: () => void;
  /** When provided, renders a back-arrow in the header (e.g. return to task drawer). */
  onBack?: () => void;
  /** When set, operates in task mode — scoped to this task's assistant session. */
  taskId?: string;
  /** When true, operates in draft mode — no task created yet; first message triggers creation. */
  draftChat?: boolean;
  /** Called with the new task ID after the first message creates the task. */
  onTaskCreated?: (taskId: string) => void;
}

export function AssistantDrawer({
  onClose,
  onBack,
  taskId,
  draftChat,
  onTaskCreated,
}: AssistantDrawerProps) {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const { showError } = useToast();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { logs, fetchLogs: fetchSessionLogs } = useSessionLogs(activeSessionId);
  const [showSessionList, setShowSessionList] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);

  const [chatTask, setChatTask] = useState<WorkflowTask | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);

  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { optimisticMessage, setOptimisticMessage, scrollTrigger, triggerScroll } =
    useOptimisticMessage(logs);

  const handleComposeResize = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const isAgentRunning = activeSession?.agent_pid != null;

  const orkBlocks = useMemo(() => parseOrkBlocks(logs), [logs]);

  // Proposal takes precedence — suppress questions when a proposal is present.
  const proposal = useMemo(
    () =>
      (orkBlocks.filter((b) => b.type === "proposal").pop() as
        | Extract<OrkBlock, { type: "proposal" }>
        | undefined) ?? null,
    [orkBlocks],
  );

  const questions: WorkflowQuestion[] = useMemo(
    () =>
      proposal
        ? []
        : ((
            orkBlocks.filter((b) => b.type === "questions").pop() as
              | Extract<OrkBlock, { type: "questions" }>
              | undefined
          )?.questions ?? []),
    [orkBlocks, proposal],
  );

  // Reset answers when question count changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on question count change
  useEffect(() => {
    setAnswers(questions.map(() => ""));
  }, [questions.length]);

  // -- Fetch sessions on mount and auto-select --
  useEffect(() => {
    if (draftChat && !taskId) {
      // Draft mode — no sessions to fetch yet.
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
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
  }, [transport, taskId, draftChat]);

  // -- Load chat task info when in task mode --
  useEffect(() => {
    if (!taskId) {
      setChatTask(null);
      return;
    }
    transport
      .call<WorkflowTask>("get_task", { task_id: taskId })
      .then((task) => setChatTask(task.is_chat ? task : null))
      .catch(() => setChatTask(null));
  }, [taskId, transport]);

  // -- Promote chat task to full workflow --
  const handlePromote = useCallback(async () => {
    if (!taskId) return;
    try {
      await transport.call("promote_to_flow", { task_id: taskId });
      setChatTask(null);
      onClose();
    } catch (err) {
      if (!isDisconnectError(err)) showError(String(err));
    }
  }, [taskId, transport, onClose, showError]);

  // -- Accept agent proposal and promote to flow --
  const handleAcceptProposal = useCallback(async () => {
    if (!taskId || !proposal) return;
    setAcceptLoading(true);
    try {
      await transport.call("promote_to_flow", {
        task_id: taskId,
        flow: proposal.flow || undefined,
        starting_stage: proposal.stage || undefined,
        title: proposal.title || undefined,
        artifact_content: proposal.content || undefined,
      });
      setChatTask(null);
      onClose();
    } catch (err) {
      if (!isDisconnectError(err)) showError(String(err));
    } finally {
      setAcceptLoading(false);
    }
  }, [taskId, proposal, transport, onClose, showError]);

  // -- Archive chat task --
  const handleArchive = useCallback(async () => {
    if (!taskId) return;
    if (!(await confirmAction("Archive this Trak?"))) return;
    try {
      await transport.call("archive", { task_id: taskId });
      onClose();
    } catch (err) {
      if (!isDisconnectError(err)) showError(String(err));
    }
  }, [taskId, transport, onClose, showError]);

  // -- Fetch the active task session by session ID (task mode only) --
  const fetchTaskSession = useCallback(async (): Promise<AssistantSession | undefined> => {
    const allSessions = await transport.call<AssistantSession[]>("assistant_list_sessions", {});
    return allSessions.find((s) => s.id === activeSessionId);
  }, [transport, activeSessionId]);

  // -- Poll logs and session while agent is running --
  const pollSession = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await fetchSessionLogs();
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
  }, [fetchSessionLogs, transport, activeSessionId, taskId, fetchTaskSession]);

  usePolling(isAgentRunning && connectionState === "connected" ? pollSession : null, 1000);

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
  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      setShowSessionList(false);
      setInputValue("");
      setOptimisticMessage(null);
    },
    [setOptimisticMessage],
  );

  // -- Shared send + refresh helper --
  const sendAndRefresh = useCallback(
    async (message: string) => {
      let session: AssistantSession;
      if (draftChat && !taskId) {
        // First message in a new chat — create task and session atomically.
        const result = await transport.call<{ task: WorkflowTask; session: AssistantSession }>(
          "create_chat_and_send",
          { message },
        );
        session = result.session;
        setActiveSessionId(session.id);
        setSessions([session]);
        setChatTask(result.task);
        onTaskCreated?.(result.task.id);
      } else if (taskId) {
        session = await transport.call<AssistantSession>("assistant_send_task_message", {
          task_id: taskId,
          message,
        });
        setActiveSessionId(session.id);
        setSessions([session]);
        // Logs refresh via the hook's effect when activeSessionId changes.
      } else {
        session = await transport.call<AssistantSession>("assistant_send_message", {
          session_id: activeSessionId,
          message,
        });
        setActiveSessionId(session.id);
        const updatedSessions = await transport.call<AssistantSession[]>(
          "assistant_list_project_sessions",
          {},
        );
        setSessions(updatedSessions);
        // Logs refresh via the hook's effect (session ID change) or event listener.
      }
    },
    [transport, activeSessionId, taskId, draftChat, onTaskCreated],
  );

  // -- Send message --
  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg || sending) return;
    setSending(true);
    setInputValue("");
    setOptimisticMessage(msg);
    triggerScroll();
    try {
      await sendAndRefresh(msg);
    } catch (err) {
      if (!isDisconnectError(err)) showError(String(err));
      setOptimisticMessage(null);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, sendAndRefresh, setOptimisticMessage, triggerScroll, showError]);

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
    setShowSessionList(false);
    setInputValue("");
    setOptimisticMessage(null);
  }, [setOptimisticMessage]);

  const displayMessages = useMemo(() => {
    const msgs = buildDisplayMessages(logs);
    if (optimisticMessage) {
      msgs.push({ kind: "user", content: optimisticMessage });
    }
    return msgs;
  }, [logs, optimisticMessage]);
  const sessionTitle = activeSession?.title ?? null;

  const headerActions = useMemo<DrawerAction[]>(
    () =>
      chatTask
        ? [
            {
              icon: ARCHIVE_ICON,
              label: "Archive",
              shortLabel: "Archive",
              onClick: handleArchive,
            },
            {
              icon: TRASH_ICON,
              label: "Delete Trak",
              shortLabel: "Delete",
              onClick: () => setShowDeleteConfirm(true),
              destructive: true,
            },
          ]
        : taskId
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
    [chatTask, taskId, activeSessionId, handleNewSession, handleArchive],
  );

  const titleNode = useMemo(
    () => (
      <span className="flex items-center gap-2.5">
        <span>{draftChat && !taskId ? "New Chat" : taskId ? "Trak Assistant" : "Assistant"}</span>
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
    [taskId, draftChat, sessionTitle],
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

  const lastAgentExtra = useMemo(() => {
    if (proposal) {
      return (
        <div className="mt-4 pt-4 border-t border-border -mx-6 px-6">
          <ProposalCard
            proposal={proposal}
            onAccept={handleAcceptProposal}
            loading={acceptLoading}
          />
        </div>
      );
    }
    if (questions.length > 0) {
      return (
        <div className="mt-4 pt-4 border-t border-border -mx-6 px-6">
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
          <div className="pb-2 flex items-center gap-3">
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
      );
    }
    return undefined;
  }, [
    proposal,
    questions,
    answers,
    answerChangeHandlers,
    sending,
    handleSendAnswers,
    handleAcceptProposal,
    acceptLoading,
  ]);

  return (
    <Drawer onClose={onClose} disableEscape={showSessionList || showDeleteConfirm}>
      <HotkeyScope active>
        <div className="flex flex-col h-full relative overflow-hidden">
          <DrawerHeader
            title={titleNode}
            onClose={onClose}
            onBack={onBack}
            actions={headerActions}
          />

          {/* Promote to Trak — chat tasks only */}
          {chatTask && (
            <div className="shrink-0 flex items-center justify-between px-6 py-2 border-b border-border bg-surface">
              <span className="font-sans text-forge-body text-text-secondary">
                Promote this chat to a full Trak?
              </span>
              <Button variant="primary" size="sm" onClick={handlePromote}>
                Promote to Trak
              </Button>
            </div>
          )}

          {/* Message List */}
          <MessageList
            messages={displayMessages}
            isAgentRunning={isAgentRunning || !!optimisticMessage}
            agentLabel="Assistant"
            containerRef={messageListRef}
            emptyText="Start a conversation with the assistant."
            lastAgentExtra={lastAgentExtra}
            scrollToBottomTrigger={scrollTrigger}
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
            onResize={handleComposeResize}
            className="shrink-0 px-6 pb-4 bg-canvas"
          />

          {/* Delete confirmation modal */}
          <ModalPanel
            isOpen={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            className="inset-0 m-auto h-fit w-80"
          >
            <div className="bg-canvas border border-border rounded-panel shadow-lg p-5 flex flex-col gap-4">
              <div>
                <p className="text-forge-body-md font-semibold text-text-primary">Delete Trak?</p>
                <p className="mt-1 text-forge-body text-text-tertiary line-clamp-2">
                  {chatTask?.title || chatTask?.description || "This chat"}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    transport
                      .call("delete_task", { task_id: taskId })
                      .then(onClose)
                      .catch((err) => {
                        if (!isDisconnectError(err)) showError(String(err));
                      });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </ModalPanel>

          {/* Session List Overlay — slides in from right (project mode only) */}
          {!taskId && (
            <div
              className={[
                "absolute inset-0 bg-surface z-20 flex flex-col transition-transform duration-[160ms] ease-out",
                showSessionList ? "translate-x-0" : "translate-x-full",
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
          )}
        </div>
      </HotkeyScope>
    </Drawer>
  );
}
