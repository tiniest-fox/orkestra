// Interactive mode drawer — agent chat + diff tabs for a task in Interactive state.
// Streams log entries from the interactive session while the agent is running.
// The "Done" footer lets the user exit interactive mode and route to a stage or
// mark as done (return to normal pipeline queue).

import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePolling } from "../../hooks/usePolling";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useToast, useWorkflowConfig } from "../../providers";
import { useConnectionState, useTransport } from "../../transport";
import type { AssistantSession, WorkflowTaskView } from "../../types/workflow";
import { stripParameterBlocks } from "../../utils/feedContent";
import { isDisconnectError } from "../../utils/transportErrors";
import { resolveFlowStageNames } from "../../utils/workflowNavigation";
import { Drawer } from "../ui/Drawer/Drawer";
import { type DrawerAction, DrawerHeader } from "../ui/Drawer/DrawerHeader";
import { HotkeyScope } from "../ui/HotkeyScope";
import { ChatComposeArea } from "./ChatComposeArea";
import { DrawerDiffTab } from "./DrawerDiffTab";
import { drawerAccent } from "./DrawerHeader";
import { DrawerTabBar } from "./DrawerTabBar";
import { DrawerTaskProvider } from "./DrawerTaskProvider";
import { buildDisplayMessages, MessageList } from "./MessageList";

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
  const connectionState = useConnectionState();
  const config = useWorkflowConfig();
  const { showError } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("agent");
  const [session, setSession] = useState<AssistantSession | null>(null);
  const { logs, fetchLogs: fetchSessionLogs } = useSessionLogs(session?.id ?? null);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [showDoneMenu, setShowDoneMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(null);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messageListRef = useRef<HTMLDivElement>(null);

  // Clear the optimistic message when real logs arrive (logs reference only changes on new entries).
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs is the trigger, not a value consumed inside
  useEffect(() => {
    setOptimisticMessage(null);
  }, [logs]);

  const isAgentRunning = session?.agent_pid != null;

  const handleComposeResize = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

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

  // -- Poll session while agent is running (logs are managed by useSessionLogs) --
  const pollSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      const [, allSessions] = await Promise.all([
        fetchSessionLogs(),
        transport.call<AssistantSession[]>("assistant_list_sessions", {}),
      ]);
      const updated = allSessions.find(
        (s) => s.task_id === task.id && s.session_type === "interactive",
      );
      if (updated) {
        setSession((prev) => {
          if (prev && prev.agent_pid === updated.agent_pid && prev.title === updated.title)
            return prev;
          return updated;
        });
      }
    } catch (err) {
      if (!isDisconnectError(err)) console.error("Failed to poll session:", err);
    }
  }, [fetchSessionLogs, transport, session?.id, task.id]);

  usePolling(isAgentRunning && connectionState === "connected" ? pollSession : null, 1000);

  // -- Send message --
  const handleSend = useCallback(async () => {
    const msg = inputValue.trim();
    if (!msg || sending) return;
    setSending(true);
    setInputValue("");
    setOptimisticMessage(msg);
    setScrollTrigger((n) => n + 1);
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
        // Logs refresh via the hook's effect when session.id changes.
      }
    } catch (err) {
      setError(String(err));
      setOptimisticMessage(null);
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

  const displayMessages = useMemo(() => {
    const msgs = buildDisplayMessages(logs);
    if (optimisticMessage) {
      msgs.push({ kind: "user", content: optimisticMessage });
    }
    return msgs;
  }, [logs, optimisticMessage]);

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
          <MessageList
            messages={displayMessages}
            isAgentRunning={isAgentRunning || !!optimisticMessage}
            agentLabel="Agent"
            containerRef={messageListRef}
            emptyText="Send a message to start the interactive session."
            contentFilter={stripParameterBlocks}
            scrollToBottomTrigger={scrollTrigger}
          />

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
            onResize={handleComposeResize}
            className="shrink-0 px-6 pb-4 bg-canvas"
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
