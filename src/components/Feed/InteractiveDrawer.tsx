// Interactive mode drawer — agent chat + diff tabs for a task in Interactive state.
// Streams log entries from the interactive session while the agent is running.
// The "Done" footer lets the user exit interactive mode and route to a stage or
// mark as done (return to normal pipeline queue).

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { usePolling } from "../../hooks/usePolling";
import { useToast, useWorkflowConfig } from "../../providers";
import { useTransport } from "../../transport";
import type { AssistantSession, LogEntry, WorkflowTaskView } from "../../types/workflow";
import { stripParameterBlocks } from "../../utils/feedContent";
import { isDisconnectError } from "../../utils/transportErrors";
import { resolveFlowStageNames } from "../../utils/workflowNavigation";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import { Drawer } from "../ui/Drawer/Drawer";
import { type DrawerAction, DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { AgentEntry, buildDisplayMessages } from "./AssistantDrawer";
import { ChatComposeArea } from "./ChatComposeArea";
import { DrawerDiffTab } from "./DrawerDiffTab";
import { drawerAccent } from "./DrawerHeader";
import { DrawerTabBar } from "./DrawerTabBar";
import { DrawerTaskProvider } from "./DrawerTaskProvider";

// ============================================================================
// Helpers
// ============================================================================

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
// Types
// ============================================================================

type TabId = "agent" | "diff";

const TABS = [
  { id: "agent" as TabId, label: "Agent", hotkey: "1" },
  { id: "diff" as TabId, label: "Diff", hotkey: "2" },
];

// ============================================================================
// DoneMenu
// ============================================================================

interface DoneMenuProps {
  task: WorkflowTaskView;
  onExit: (targetStage: string | null) => void;
  onClose: () => void;
}

function DoneMenu({ task, onExit, onClose }: DoneMenuProps) {
  const config = useWorkflowConfig();
  const menuRef = useRef<HTMLDivElement>(null);

  const stageNames = resolveFlowStageNames(task.flow, config);
  const currentStage = task.derived.current_stage;

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-panel-sm shadow-lg z-10 overflow-hidden"
    >
      <div className="px-3 py-1.5 border-b border-border">
        <span className="font-mono text-forge-mono-label text-text-quaternary uppercase tracking-wider">
          Send task to stage
        </span>
      </div>
      {stageNames.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onExit(name)}
          onKeyDown={() => {}}
          className={[
            "w-full text-left px-3 py-2 font-sans text-forge-body transition-colors",
            name === currentStage
              ? "text-accent font-medium bg-accent/5 hover:bg-accent/10"
              : "text-text-primary hover:bg-canvas",
          ].join(" ")}
        >
          {name}
          {name === currentStage && (
            <span className="ml-2 font-mono text-forge-mono-label text-text-quaternary">
              current
            </span>
          )}
        </button>
      ))}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => onExit(null)}
          onKeyDown={() => {}}
          className="w-full text-left px-3 py-2 font-sans text-forge-body text-text-secondary hover:bg-canvas transition-colors"
        >
          Mark as Done
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// InteractiveDrawerBody (internal)
// ============================================================================

interface InteractiveDrawerBodyProps {
  task: WorkflowTaskView;
  onClose: () => void;
}

function InteractiveDrawerBody({ task, onClose }: InteractiveDrawerBodyProps) {
  const transport = useTransport();
  const config = useWorkflowConfig();
  const { showError } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("agent");
  const [session, setSession] = useState<AssistantSession | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [showDoneMenu, setShowDoneMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { containerRef: messageListRef, handleScroll } = useAutoScroll<HTMLDivElement>(true);

  const isAgentRunning = session?.agent_pid != null;

  // -- Fetch interactive session on mount --
  useEffect(() => {
    transport
      .call<AssistantSession[]>("assistant_list_sessions", {})
      .then((sessions) => {
        const found = sessions.find(
          (s) => s.task_id === task.id && s.session_type === "interactive",
        );
        if (found) {
          setSession(found);
        }
      })
      .catch(console.error);
  }, [transport, task.id]);

  // -- Fetch logs when session changes --
  useEffect(() => {
    if (!session?.id) return;
    transport
      .call<LogEntry[]>("assistant_get_logs", { session_id: session.id })
      .then(setLogs)
      .catch(console.error);
  }, [transport, session?.id]);

  // -- Poll logs and session while agent is running --
  const pollSession = useCallback(async () => {
    if (!session?.id) return;
    const [newLogs, allSessions] = await Promise.all([
      transport.call<LogEntry[]>("assistant_get_logs", { session_id: session.id }),
      transport.call<AssistantSession[]>("assistant_list_sessions", {}),
    ]);
    setLogs(newLogs);
    const updated = allSessions.find(
      (s) => s.task_id === task.id && s.session_type === "interactive",
    );
    if (updated) setSession(updated);
  }, [transport, session?.id, task.id]);

  usePolling(isAgentRunning ? pollSession : null, 1000);

  // -- Send message --
  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg || sending) return;
    setSending(true);
    setInputValue("");
    setError(null);
    try {
      await transport.call("interactive_send_message", { task_id: task.id, message: msg });
      // Re-fetch session list and logs after send (session may be newly created)
      const allSessions = await transport.call<AssistantSession[]>("assistant_list_sessions", {});
      const found = allSessions.find(
        (s) => s.task_id === task.id && s.session_type === "interactive",
      );
      if (found) {
        setSession(found);
        const updatedLogs = await transport.call<LogEntry[]>("assistant_get_logs", {
          session_id: found.id,
        });
        setLogs(updatedLogs);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, transport, task.id]);

  // -- Stop agent --
  const handleStop = useCallback(async () => {
    if (!session?.id) return;
    await transport.call("assistant_stop", { session_id: session.id }).catch((err) => {
      if (!isDisconnectError(err)) showError(String(err));
    });
    const allSessions = await transport
      .call<AssistantSession[]>("assistant_list_sessions", {})
      .catch(() => [] as AssistantSession[]);
    const updated = allSessions.find(
      (s) => s.task_id === task.id && s.session_type === "interactive",
    );
    if (updated) setSession(updated);
  }, [transport, session?.id, task.id, showError]);

  // -- Exit interactive mode --
  const handleExit = useCallback(
    async (targetStage: string | null) => {
      setShowDoneMenu(false);
      setExiting(true);
      setError(null);
      try {
        await transport.call("interactive_exit", {
          task_id: task.id,
          target_stage: targetStage,
        });
        onClose();
      } catch (err) {
        setError(String(err));
        setExiting(false);
      }
    },
    [transport, task.id, onClose],
  );

  const displayMessages = buildDisplayMessages(logs);

  const headerActions: DrawerAction[] = [
    {
      icon: <Check size={14} />,
      label: "Done",
      onClick: () => setShowDoneMenu((o) => !o),
      disabled: exiting,
      active: showDoneMenu,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="relative">
        <DrawerHeader title="Interactive" onClose={onClose} actions={headerActions} />
        {showDoneMenu && (
          <DoneMenu task={task} onExit={handleExit} onClose={() => setShowDoneMenu(false)} />
        )}
      </div>
      <DrawerTabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
        accent={drawerAccent(task, config)}
      />

      {/* Agent tab */}
      {activeTab === "agent" && (
        <>
          <div
            ref={messageListRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto bg-canvas"
          >
            {displayMessages.length === 0 && !isAgentRunning && (
              <div className="flex items-center justify-center h-full">
                <p className="font-mono text-forge-mono-sm text-text-quaternary">
                  Send a message to start the interactive session.
                </p>
              </div>
            )}
            {displayMessages.map((msg, i) => (
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
                    "font-mono text-forge-mono-label font-medium uppercase tracking-wider mb-1.5",
                    msg.kind === "user" ? "text-accent" : "text-text-tertiary",
                  ].join(" ")}
                >
                  {msg.kind === "user" ? "You" : "Agent"}
                </div>
                {msg.kind === "agent" ? (
                  <div className="text-text-secondary">
                    <AgentEntries entries={msg.entries} />
                  </div>
                ) : (
                  <div className="font-sans text-forge-body text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {stripParameterBlocks(msg.content)}
                  </div>
                )}
              </div>
            ))}

            {isAgentRunning && (
              <div className="flex items-center gap-2 px-6 py-3.5 text-text-quaternary">
                <span className="w-3.5 h-3.5 border-2 border-border border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="font-mono text-forge-mono-sm">Working…</span>
              </div>
            )}
          </div>

          <ChatComposeArea
            value={inputValue}
            onChange={setInputValue}
            textareaRef={textareaRef}
            sending={sending}
            agentActive={isAgentRunning}
            onSend={handleSend}
            onStop={handleStop}
            placeholder="Direct the agent…"
            error={error}
            className="shrink-0 px-4 pt-2 pb-4 bg-canvas"
          />
        </>
      )}

      {/* Diff tab */}
      {activeTab === "diff" && <DrawerDiffTab active />}

      {/* Error display for non-agent tabs */}
      {activeTab !== "agent" && error && (
        <div className="shrink-0 px-4 py-3 border-t border-border bg-canvas">
          <p className="font-sans text-forge-mono-md text-status-error">{error}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// InteractiveDrawer (exported)
// ============================================================================

interface InteractiveDrawerProps {
  task: WorkflowTaskView;
  onClose: () => void;
}

export function InteractiveDrawer({ task, onClose }: InteractiveDrawerProps) {
  return (
    <Drawer onClose={onClose}>
      <HotkeyScope active>
        <DrawerTaskProvider taskId={task.id}>
          <InteractiveDrawerBody task={task} onClose={onClose} />
        </DrawerTaskProvider>
      </HotkeyScope>
    </Drawer>
  );
}
