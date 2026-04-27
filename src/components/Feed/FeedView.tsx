// Feed view displaying tasks grouped by intent with pipeline bars and status symbols.

import { Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrawerHistory } from "../../hooks/useDrawerHistory";
import { useIsMobile } from "../../hooks/useIsMobile";
import { stalenessClass } from "../../hooks/useStalenessTimer";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import { usePrStatus } from "../../providers/PrStatusProvider";
import { useTasks } from "../../providers/TasksProvider";
import { useToast } from "../../providers/ToastProvider";
import { useConnectionState, useTransport } from "../../transport";
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
import { FileViewerDrawer } from "./FileViewerDrawer";
import { GitHistoryDrawer } from "./GitHistoryDrawer";
import { MobileTabBar } from "./MobileTabBar";
import { NewTaskDrawer } from "./NewTaskDrawer";
import { NewTaskModal } from "./NewTaskModal";
import { NotificationBanner } from "./NotificationBanner";
import { taskMatchesFilter } from "./useCommandBar";
import { useFeedNavigation } from "./useFeedNavigation";
import { useFocusSaveRestore } from "./useFocusSaveRestore";
import { useNewTask } from "./useNewTask";

// -- Helpers --

type DrawerMode =
  | "new-task"
  | "git-history"
  | "assistant"
  | "review"
  | "answer"
  | "focus"
  | "ship"
  | "file-viewer"
  | null;

function deriveDrawerMode(
  isNewTaskOpen: boolean,
  gitHistoryOpen: boolean,
  assistantOpen: boolean,
  taskAssistantOpen: boolean,
  draftChatOpen: boolean,
  fileViewerOpen: boolean,
  activeTask: WorkflowTaskView | null,
): DrawerMode {
  if (isNewTaskOpen) return "new-task";
  if (assistantOpen || taskAssistantOpen || draftChatOpen) return "assistant";
  if (gitHistoryOpen) return "git-history";
  if (fileViewerOpen) return "file-viewer";
  if (!activeTask) return null;
  if (activeTask.derived.needs_review) return "review";
  if (activeTask.derived.has_questions) return "answer";
  if (activeTask.derived.is_done) return "ship";
  return "focus";
}

interface FeedViewProps {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
  serviceProjectName?: string;
  showHomeLink?: boolean;
}

export function FeedView({ config, tasks, serviceProjectName, showHomeLink }: FeedViewProps) {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const { applyOptimistic, isStale } = useTasks();
  const { showError } = useToast();
  const isMobile = useIsMobile();
  const feedBodyRef = useRef<HTMLDivElement>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [taskAssistantId, setTaskAssistantId] = useState<string | null>(null);
  const [draftChatOpen, setDraftChatOpen] = useState(false);
  const [fileViewerPath, setFileViewerPath] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const commandBarInputRef = useRef<HTMLInputElement>(null);

  const panelOpen =
    activeTaskId !== null ||
    gitHistoryOpen ||
    assistantOpen ||
    taskAssistantId !== null ||
    draftChatOpen ||
    fileViewerPath !== null;
  const { isNewTaskOpen, openNewTask, closeNewTask } = useNewTask();
  const { pushToOrigin, pullFromOrigin, fetchFromOrigin } = useGitHistory();
  const { getPrStatus } = usePrStatus();

  const drawerOpen = panelOpen || isNewTaskOpen;
  const activeTask = activeTaskId ? (tasks.find((t) => t.id === activeTaskId) ?? null) : null;

  const closeAllDrawers = useCallback(() => {
    setActiveTaskId(null);
    setGitHistoryOpen(false);
    setAssistantOpen(false);
    setTaskAssistantId(null);
    setDraftChatOpen(false);
    setFileViewerPath(null);
    closeNewTask();
  }, [closeNewTask]);

  useDrawerHistory(drawerOpen, closeAllDrawers);

  const drawerMode = deriveDrawerMode(
    isNewTaskOpen,
    gitHistoryOpen,
    assistantOpen,
    taskAssistantId !== null,
    draftChatOpen,
    fileViewerPath !== null,
    activeTask,
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

  // Fetch file list whenever connection is established.
  useEffect(() => {
    if (connectionState !== "connected") return;
    transport
      .call<string[]>("list_project_files")
      .then(setProjectFiles)
      .catch((err) => {
        if (!isDisconnectError(err)) console.error("Failed to load project files:", err);
      });
  }, [connectionState, transport]);

  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
    setActiveTaskId(null);
    setGitHistoryOpen(false);
    setTaskAssistantId(null);
    setFileViewerPath(null);
  }, []);

  const openNewChat = useCallback(() => {
    setDraftChatOpen(true);
    setTaskAssistantId(null);
    setActiveTaskId(null);
    setAssistantOpen(false);
    setGitHistoryOpen(false);
    setFileViewerPath(null);
  }, []);

  const handleChatTaskCreated = useCallback((taskId: string) => {
    setTaskAssistantId(taskId);
    setDraftChatOpen(false);
  }, []);

  const openTaskAssistant = useCallback((taskId: string) => {
    setTaskAssistantId(taskId);
    setActiveTaskId(null);
    setAssistantOpen(false);
    setGitHistoryOpen(false);
    setFileViewerPath(null);
  }, []);

  const handleAssistantClose = useCallback(() => {
    setAssistantOpen(false);
    setTaskAssistantId(null);
    setDraftChatOpen(false);
  }, []);

  const handleAssistantBack = useCallback(() => {
    if (taskAssistantId) {
      setActiveTaskId(taskAssistantId);
      setTaskAssistantId(null);
    }
  }, [taskAssistantId]);

  const onStripRowClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task?.is_chat) {
        setTaskAssistantId(taskId);
        setActiveTaskId(null);
        setAssistantOpen(false);
        setGitHistoryOpen(false);
        setFileViewerPath(null);
      } else {
        setGitHistoryOpen(false);
        setAssistantOpen(false);
        setTaskAssistantId(null);
        setFileViewerPath(null);
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

  const handleSelectFile = useCallback(
    (filePath: string) => {
      clearFilter();
      commandBarInputRef.current?.blur();
      setActiveTaskId(null);
      setGitHistoryOpen(false);
      setAssistantOpen(false);
      setTaskAssistantId(null);
      setFileViewerPath(filePath);
    },
    [clearFilter],
  );

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
          setFileViewerPath(null);
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

  // Shift+A creates a new chat task and opens AssistantDrawer for it.
  useEffect(() => {
    if (isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "A" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openNewChat();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, openNewChat]);

  return (
    <div className="h-full flex flex-col rounded-panel overflow-hidden relative bg-canvas">
      <FeedHeader
        tasks={tasks}
        onNewTask={openNewTask}
        onNewChat={openNewChat}
        hotkeyActive={!drawerOpen}
        serviceProjectName={serviceProjectName}
        showHomeLink={showHomeLink}
      />
      <CommandBar
        tasks={tasks}
        projectFiles={projectFiles}
        filterText={filterText}
        onFilterChange={handleFilterChange}
        onExecuteCommand={handleExecuteCommand}
        onSelectTask={handleSelectTask}
        onSelectFile={handleSelectFile}
        inputRef={commandBarInputRef}
      />
      {isMobile && <NotificationBanner />}
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
                getPrStatus={getPrStatus}
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
                onDelete={async (taskId) => {
                  if (!(await confirmAction("Delete this Trak? This cannot be undone."))) return;
                  transport.call("delete_task", { task_id: taskId }).catch((err) => {
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
          setTaskAssistantId(null);
          setFileViewerPath(null);
        }}
      />
      {isMobile && (
        <MobileTabBar
          gitActive={gitHistoryOpen}
          assistantActive={assistantOpen || taskAssistantId !== null || draftChatOpen}
          onGitOpen={() => {
            setGitHistoryOpen((o) => !o);
            setActiveTaskId(null);
            setAssistantOpen(false);
            setTaskAssistantId(null);
            setFileViewerPath(null);
          }}
          onNewTask={() => {
            setGitHistoryOpen(false);
            setAssistantOpen(false);
            setTaskAssistantId(null);
            setActiveTaskId(null);
            setFileViewerPath(null);
            openNewTask();
          }}
          onAssistantOpen={() => {
            setAssistantOpen((prev) => {
              if (!prev) {
                setActiveTaskId(null);
                setGitHistoryOpen(false);
                setTaskAssistantId(null);
                setFileViewerPath(null);
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
          onCreate={async (description, autoMode, baseBranch, flow) => {
            await transport.call("create_task", {
              title: "",
              description,
              base_branch: baseBranch || null,
              auto_mode: autoMode,
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
              onCreate={async (description, autoMode, baseBranch, flow) => {
                await transport.call("create_task", {
                  title: "",
                  description,
                  base_branch: baseBranch || null,
                  auto_mode: autoMode,
                  flow: flow ?? null,
                });
              }}
            />
          )}
        </ModalPanel>
      )}
      {(assistantOpen || taskAssistantId || draftChatOpen) && (
        <AssistantDrawer
          onClose={handleAssistantClose}
          onBack={taskAssistantId ? handleAssistantBack : undefined}
          taskId={taskAssistantId ?? undefined}
          draftChat={draftChatOpen && !taskAssistantId}
          onTaskCreated={handleChatTaskCreated}
        />
      )}
      {gitHistoryOpen && <GitHistoryDrawer onClose={() => setGitHistoryOpen(false)} />}
      {fileViewerPath && (
        <FileViewerDrawer filePath={fileViewerPath} onClose={() => setFileViewerPath(null)} />
      )}
      {activeTask && (
        <TaskDrawer
          task={activeTask}
          allTasks={tasks}
          onClose={() => setActiveTaskId(null)}
          onOpenTask={setActiveTaskId}
          onOpenChat={() => openTaskAssistant(activeTask.id)}
        />
      )}
    </div>
  );
}
