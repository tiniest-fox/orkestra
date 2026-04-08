// Feed view displaying tasks grouped by intent with pipeline bars and status symbols.

import { AnimatePresence, motion } from "framer-motion";
import { Inbox, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrawerHistory } from "../../hooks/useDrawerHistory";
import { useIsMobile } from "../../hooks/useIsMobile";
import { stalenessClass } from "../../hooks/useStalenessTimer";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import { usePrStatus } from "../../providers/PrStatusProvider";
import { useTasks } from "../../providers/TasksProvider";
import { useToast } from "../../providers/ToastProvider";
import { useTransport } from "../../transport";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { confirmAction } from "../../utils/confirmAction";
import { groupTasksForFeed } from "../../utils/feedGrouping";
import { isDisconnectError } from "../../utils/transportErrors";
import { EmptyState } from "../ui/EmptyState";
import { ModalPanel } from "../ui/ModalPanel";
import { NavigationScope } from "../ui/NavigationScope";
import { AssistantDrawer } from "./AssistantDrawer";
import { CommandBar } from "./CommandBar";
import { TaskDrawer } from "./Drawer/TaskDrawer";
import { FeedHeader } from "./FeedHeader";
import { FeedSection } from "./FeedSection";
import { FeedStatusLine } from "./FeedStatusLine";
import { GitHistoryDrawer } from "./GitHistoryDrawer";
import { InteractiveDrawer } from "./InteractiveDrawer";
import { MobileTabBar } from "./MobileTabBar";
import { NewTaskDrawer } from "./NewTaskDrawer";
import { NewTaskModal } from "./NewTaskModal";
import { taskMatchesFilter } from "./useCommandBar";
import { useFeedNavigation } from "./useFeedNavigation";
import { useFocusSaveRestore } from "./useFocusSaveRestore";
import { useNewTask } from "./useNewTask";

// -- Helpers --

type DrawerMode =
  | "new-task"
  | "git-history"
  | "assistant"
  | "interactive"
  | "review-reject"
  | "review"
  | "answer"
  | "focus"
  | "ship"
  | null;

function deriveDrawerMode(
  isNewTaskOpen: boolean,
  gitHistoryOpen: boolean,
  assistantOpen: boolean,
  taskAssistantOpen: boolean,
  interactiveTaskOpen: boolean,
  activeTask: WorkflowTaskView | null,
  rejectMode: boolean,
): DrawerMode {
  if (isNewTaskOpen) return "new-task";
  if (assistantOpen || taskAssistantOpen) return "assistant";
  if (gitHistoryOpen) return "git-history";
  if (interactiveTaskOpen) return "interactive";
  if (!activeTask) return null;
  if (activeTask.derived.needs_review) return rejectMode ? "review-reject" : "review";
  if (activeTask.derived.has_questions) return "answer";
  if (activeTask.derived.is_done) return "ship";
  return "focus";
}

interface FeedViewProps {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
  serviceProjectName?: string;
  showHomeLink?: boolean;
  notificationPermission?: NotificationPermission | "unsupported";
  onRequestNotifications?: () => void;
}

export function FeedView({
  config,
  tasks,
  serviceProjectName,
  showHomeLink,
  notificationPermission,
  onRequestNotifications,
}: FeedViewProps) {
  const transport = useTransport();
  const { applyOptimistic, isStale } = useTasks();
  const { showError } = useToast();
  const isMobile = useIsMobile();
  const feedBodyRef = useRef<HTMLDivElement>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [taskAssistantId, setTaskAssistantId] = useState<string | null>(null);
  const [interactiveTaskId, setInteractiveTaskId] = useState<string | null>(null);
  const commandBarInputRef = useRef<HTMLInputElement>(null);
  const [notificationBannerDismissed, setNotificationBannerDismissed] = useState(false);

  const panelOpen =
    activeTaskId !== null ||
    gitHistoryOpen ||
    assistantOpen ||
    taskAssistantId !== null ||
    interactiveTaskId !== null;
  const { isNewTaskOpen, openNewTask, closeNewTask } = useNewTask();
  const { pushToOrigin, pullFromOrigin, fetchFromOrigin } = useGitHistory();
  const { getPrStatus } = usePrStatus();

  const drawerOpen = panelOpen || isNewTaskOpen;
  const activeTask = activeTaskId ? (tasks.find((t) => t.id === activeTaskId) ?? null) : null;
  const interactiveTask = interactiveTaskId
    ? (tasks.find((t) => t.id === interactiveTaskId) ?? null)
    : null;

  const closeAllDrawers = useCallback(() => {
    setActiveTaskId(null);
    setGitHistoryOpen(false);
    setAssistantOpen(false);
    setTaskAssistantId(null);
    setInteractiveTaskId(null);
    closeNewTask();
  }, [closeNewTask]);

  useDrawerHistory(drawerOpen, closeAllDrawers);

  const drawerMode = deriveDrawerMode(
    isNewTaskOpen,
    gitHistoryOpen,
    assistantOpen,
    taskAssistantId !== null,
    interactiveTaskId !== null,
    activeTask,
    rejectMode,
  );

  const { sections, subtaskRows } = useMemo(() => {
    const prStates = new Map<string, string>();
    for (const task of tasks) {
      if (task.pr_url && task.derived.is_done) {
        const status = getPrStatus(task.id);
        if (status?.state) {
          prStates.set(task.id, status.state);
        }
      }
    }
    return groupTasksForFeed(tasks, prStates);
  }, [tasks, getPrStatus]);

  // Derive whether any task has an active assistant agent
  const anyAssistantActive = useMemo(
    () => tasks.some((t) => t.derived.chat_agent_active || t.derived.is_chatting),
    [tasks],
  );

  // Track unread assistant responses
  const [hasUnreadAssistant, setHasUnreadAssistant] = useState(false);
  const assistantDrawerOpen = assistantOpen || taskAssistantId !== null;
  const prevAssistantActiveRef = useRef(false);

  useEffect(() => {
    // Detect active → inactive transition while drawer is closed
    if (prevAssistantActiveRef.current && !anyAssistantActive && !assistantDrawerOpen) {
      setHasUnreadAssistant(true);
    }
    prevAssistantActiveRef.current = anyAssistantActive;
  }, [anyAssistantActive, assistantDrawerOpen]);

  // Clear unread when drawer opens
  useEffect(() => {
    if (assistantDrawerOpen) {
      setHasUnreadAssistant(false);
    }
  }, [assistantDrawerOpen]);

  // All task IDs for keyboard navigation. Navigation is suppressed while the user
  // is typing in the command bar input, so the unfiltered list is correct here.
  const allOrderedIds = useMemo(() => {
    const ids: string[] = [];
    for (const section of sections) {
      for (const task of section.tasks) {
        ids.push(task.id);
        for (const sub of subtaskRows.filter((s) => s.parent_id === task.id)) {
          ids.push(sub.id);
        }
      }
    }
    return ids;
  }, [sections, subtaskRows]);

  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
    setActiveTaskId(null);
    setGitHistoryOpen(false);
    setTaskAssistantId(null);
    setInteractiveTaskId(null);
  }, []);

  const openTaskAssistant = useCallback((taskId: string) => {
    setTaskAssistantId(taskId);
    setActiveTaskId(null);
    setAssistantOpen(false);
    setGitHistoryOpen(false);
    setInteractiveTaskId(null);
  }, []);

  const openInteractive = useCallback(
    async (taskId: string) => {
      try {
        await transport.call("interactive_enter", { task_id: taskId });
        setInteractiveTaskId(taskId);
        setActiveTaskId(null);
        setGitHistoryOpen(false);
        setAssistantOpen(false);
        setTaskAssistantId(null);
      } catch (err) {
        console.error(err);
      }
    },
    [transport],
  );

  const onStripRowClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      setGitHistoryOpen(false);
      setAssistantOpen(false);
      setTaskAssistantId(null);
      if (task?.derived.is_interactive) {
        setInteractiveTaskId(taskId);
        setActiveTaskId(null);
      } else {
        setInteractiveTaskId(null);
        setActiveTaskId(taskId);
      }
    },
    [tasks],
  );

  // Disable feed navigation while the drawer is open; suppress focusedId so row scopes deactivate.
  const {
    focusedId: rawFocusedId,
    setFocusedId,
    scrollSeq,
  } = useFeedNavigation(allOrderedIds, drawerOpen, onStripRowClick);
  const focusedId = drawerOpen ? null : rawFocusedId;

  const { filterText, handleFilterChange, clearFilter } = useFocusSaveRestore({
    currentFocusedId: rawFocusedId,
    onRestoreFocus: setFocusedId,
  });

  const filteredSections = useMemo(() => {
    if (!filterText) return sections;
    return sections
      .map((section) => ({
        ...section,
        tasks: section.tasks.filter((t) => taskMatchesFilter(t.title, filterText)),
      }))
      .filter((section) => section.tasks.length > 0);
  }, [sections, filterText]);

  const hasNoTasks = sections.every((s) => s.tasks.length === 0) && subtaskRows.length === 0;
  const hasNoFilterMatches = filterText.length > 0 && !hasNoTasks && filteredSections.length === 0;

  const handleExecuteCommand = useCallback(
    (command: string) => {
      clearFilter();
      commandBarInputRef.current?.blur();

      switch (command) {
        case "new":
          openNewTask();
          break;
        case "fetch":
          fetchFromOrigin();
          break;
        case "pull":
          pullFromOrigin();
          break;
        case "push":
          pushToOrigin();
          break;
        case "assistant":
          openAssistant();
          break;
        case "history":
          setGitHistoryOpen(true);
          setActiveTaskId(null);
          setAssistantOpen(false);
          setTaskAssistantId(null);
          setInteractiveTaskId(null);
          break;
      }
    },
    [clearFilter, openNewTask, fetchFromOrigin, pullFromOrigin, pushToOrigin, openAssistant],
  );

  const handleSelectTask = useCallback(
    (taskId: string) => {
      clearFilter();
      commandBarInputRef.current?.blur();
      onStripRowClick(taskId);
    },
    [clearFilter, onStripRowClick],
  );

  // Cmd+K to focus command bar; Esc to blur and clear when focused.
  useEffect(() => {
    if (isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        commandBarInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === commandBarInputRef.current) {
        e.preventDefault();
        clearFilter();
        commandBarInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFilter, isMobile]);

  // Shift+A toggles the assistant panel.
  useEffect(() => {
    if (isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "A" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAssistantOpen((prev) => {
          if (!prev) {
            setActiveTaskId(null);
            setGitHistoryOpen(false);
            setTaskAssistantId(null);
            setInteractiveTaskId(null);
          }
          return !prev;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile]);

  return (
    <div className="h-full flex flex-col rounded-panel overflow-hidden relative bg-canvas">
      <FeedHeader
        tasks={tasks}
        onNewTask={openNewTask}
        onAssistant={openAssistant}
        hotkeyActive={!drawerOpen}
        assistantActive={assistantOpen}
        serviceProjectName={serviceProjectName}
        showHomeLink={showHomeLink}
        notificationPermission={notificationPermission}
        onRequestNotifications={onRequestNotifications}
      />
      <CommandBar
        tasks={tasks}
        filterText={filterText}
        onFilterChange={handleFilterChange}
        onExecuteCommand={handleExecuteCommand}
        onSelectTask={handleSelectTask}
        inputRef={commandBarInputRef}
      />
      {isMobile && !import.meta.env.TAURI_ENV_PLATFORM && (
        <AnimatePresence>
          {notificationPermission === "default" && !notificationBannerDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-2 px-4 py-2 bg-surface-2/90 backdrop-blur-sm border-b border-border"
            >
              <span className="text-forge-mono-sm text-text-secondary flex-1">
                Enable notifications to get alerts when reviews are ready
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onRequestNotifications?.()}
                  className="text-forge-mono-sm font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  Enable
                </button>
                <button
                  type="button"
                  onClick={() => setNotificationBannerDismissed(true)}
                  className="text-text-quaternary hover:text-text-secondary transition-colors"
                  aria-label="Dismiss notification banner"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <div ref={feedBodyRef} className="flex-1 overflow-y-auto flex flex-col">
        <NavigationScope activeId={focusedId} containerRef={feedBodyRef} scrollSeq={scrollSeq}>
          <div className={stalenessClass(isStale)}>
            {filteredSections.map((section) => (
              <FeedSection
                key={section.name}
                section={section}
                surfacedSubtasks={subtaskRows}
                config={config}
                focusedId={focusedId}
                onFocusRow={setFocusedId}
                onReview={setActiveTaskId}
                onAnswer={setActiveTaskId}
                onApprove={(taskId) => {
                  applyOptimistic(taskId, { type: "approve" });
                  transport.call("approve", { task_id: taskId }).catch((err) => {
                    if (!isDisconnectError(err)) showError(String(err));
                  });
                }}
                onMerge={(taskId) => {
                  transport.call("merge_task", { task_id: taskId }).catch((err) => {
                    if (!isDisconnectError(err)) showError(String(err));
                  });
                }}
                onOpenPr={(taskId) => {
                  transport.call("open_pr", { task_id: taskId }).catch((err) => {
                    if (!isDisconnectError(err)) showError(String(err));
                  });
                }}
                onArchive={async (taskId) => {
                  if (!(await confirmAction("Archive this Trak?"))) return;
                  applyOptimistic(taskId, { type: "archive" });
                  transport.call("archive", { task_id: taskId }).catch((err) => {
                    if (!isDisconnectError(err)) showError(String(err));
                  });
                }}
                onRowClick={onStripRowClick}
              />
            ))}
          </div>
          {hasNoTasks && !filterText && (
            <EmptyState
              className="flex-1"
              icon={Inbox}
              message="No Traks yet."
              description="Create a Trak to get started."
            />
          )}
          {hasNoFilterMatches && (
            <EmptyState
              className="flex-1"
              icon={Inbox}
              message="No matching Traks."
              description="Try a different search term."
            />
          )}
        </NavigationScope>
      </div>
      <FeedStatusLine
        tasks={tasks}
        drawerMode={drawerMode}
        onToggleHistory={() => {
          setGitHistoryOpen((o) => !o);
          setActiveTaskId(null);
          setAssistantOpen(false);
          setInteractiveTaskId(null);
        }}
      />
      {isMobile && (
        <MobileTabBar
          gitActive={gitHistoryOpen}
          assistantActive={assistantOpen || taskAssistantId !== null}
          assistantAgentActive={anyAssistantActive}
          hasUnreadAssistant={hasUnreadAssistant}
          onGitOpen={() => {
            setGitHistoryOpen((o) => !o);
            setActiveTaskId(null);
            setAssistantOpen(false);
            setTaskAssistantId(null);
            setInteractiveTaskId(null);
          }}
          onNewTask={() => {
            setGitHistoryOpen(false);
            setAssistantOpen(false);
            setTaskAssistantId(null);
            setInteractiveTaskId(null);
            setActiveTaskId(null);
            openNewTask();
          }}
          onAssistantOpen={() => {
            setAssistantOpen((prev) => {
              if (!prev) {
                setActiveTaskId(null);
                setGitHistoryOpen(false);
                setTaskAssistantId(null);
                setInteractiveTaskId(null);
              }
              return !prev;
            });
          }}
        />
      )}
      {isMobile && isNewTaskOpen && (
        <NewTaskDrawer
          config={config}
          onClose={closeNewTask}
          onCreate={async (description, autoMode, baseBranch, flow, interactive) => {
            await transport.call("create_task", {
              title: "",
              description,
              base_branch: baseBranch || null,
              auto_mode: autoMode,
              interactive: interactive ?? false,
              flow: flow ?? null,
            });
          }}
        />
      )}
      {!isMobile && (
        <ModalPanel
          isOpen={isNewTaskOpen}
          onClose={closeNewTask}
          className="top-[15%] left-0 right-0 mx-auto w-fit"
        >
          {isNewTaskOpen && (
            <NewTaskModal
              config={config}
              onClose={closeNewTask}
              onCreate={async (description, autoMode, baseBranch, flow, interactive) => {
                await transport.call("create_task", {
                  title: "",
                  description,
                  base_branch: baseBranch || null,
                  auto_mode: autoMode,
                  interactive: interactive ?? false,
                  flow: flow ?? null,
                });
              }}
            />
          )}
        </ModalPanel>
      )}
      {(assistantOpen || taskAssistantId) && (
        <AssistantDrawer
          onClose={() => {
            setAssistantOpen(false);
            setTaskAssistantId(null);
          }}
          onBack={
            taskAssistantId
              ? () => {
                  setActiveTaskId(taskAssistantId);
                  setTaskAssistantId(null);
                }
              : undefined
          }
          taskId={taskAssistantId ?? undefined}
        />
      )}
      {interactiveTask && (
        <InteractiveDrawer task={interactiveTask} onClose={() => setInteractiveTaskId(null)} />
      )}
      {gitHistoryOpen && <GitHistoryDrawer onClose={() => setGitHistoryOpen(false)} />}
      {activeTask && (
        <TaskDrawer
          task={activeTask}
          allTasks={tasks}
          onClose={() => setActiveTaskId(null)}
          onOpenTask={setActiveTaskId}
          onRejectModeChange={setRejectMode}
          onOpenChat={() => openTaskAssistant(activeTask.id)}
          onInteractive={() => openInteractive(activeTask.id)}
        />
      )}
    </div>
  );
}
