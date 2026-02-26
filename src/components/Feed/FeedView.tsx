//! Feed view displaying tasks grouped by intent with pipeline bars and status symbols.

import { invoke } from "@tauri-apps/api/core";
import { Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGitHistory } from "../../providers/GitHistoryProvider";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { groupTasksForFeed } from "../../utils/feedGrouping";
import { EmptyState } from "../ui/EmptyState";
import { ModalPanel } from "../ui/ModalPanel";
import { NavigationScope } from "../ui/NavigationScope";
import { CommandBar } from "./CommandBar";
import { TaskDrawer } from "./Drawer/TaskDrawer";
import { FeedHeader } from "./FeedHeader";
import { FeedSection } from "./FeedSection";
import { FeedStatusLine } from "./FeedStatusLine";
import { GitHistoryDrawer } from "./GitHistoryDrawer";
import { NewTaskModal } from "./NewTaskModal";
import { taskMatchesFilter } from "./useCommandBar";
import { useFeedNavigation } from "./useFeedNavigation";
import { useFocusSaveRestore } from "./useFocusSaveRestore";
import { useNewTask } from "./useNewTask";

// -- Helpers --

type DrawerMode =
  | "new-task"
  | "git-history"
  | "review-reject"
  | "review"
  | "answer"
  | "focus"
  | "ship"
  | null;

function deriveDrawerMode(
  isNewTaskOpen: boolean,
  gitHistoryOpen: boolean,
  activeTask: WorkflowTaskView | null,
  rejectMode: boolean,
): DrawerMode {
  if (isNewTaskOpen) return "new-task";
  if (gitHistoryOpen) return "git-history";
  if (!activeTask) return null;
  if (activeTask.derived.needs_review) return rejectMode ? "review-reject" : "review";
  if (activeTask.derived.has_questions) return "answer";
  if (activeTask.derived.is_done) return "ship";
  return "focus";
}

interface FeedViewProps {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
}

export function FeedView({ config, tasks }: FeedViewProps) {
  const feedBodyRef = useRef<HTMLDivElement>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const commandBarInputRef = useRef<HTMLInputElement>(null);

  const panelOpen = activeTaskId !== null || gitHistoryOpen;
  const { isNewTaskOpen, openNewTask, closeNewTask } = useNewTask();
  const { pushToOrigin, pullFromOrigin, fetchFromOrigin } = useGitHistory();

  const drawerOpen = panelOpen || isNewTaskOpen;
  const activeTask = activeTaskId ? (tasks.find((t) => t.id === activeTaskId) ?? null) : null;

  const drawerMode = deriveDrawerMode(isNewTaskOpen, gitHistoryOpen, activeTask, rejectMode);

  const { sections, subtaskRows } = useMemo(() => groupTasksForFeed(tasks), [tasks]);

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

  const onStripRowClick = useCallback((taskId: string) => {
    setGitHistoryOpen(false);
    setActiveTaskId(taskId);
  }, []);

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
        case "history":
          setGitHistoryOpen(true);
          setActiveTaskId(null);
          break;
      }
    },
    [clearFilter, openNewTask, fetchFromOrigin, pullFromOrigin, pushToOrigin],
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
  }, [clearFilter]);

  return (
    <div className="h-full flex flex-col rounded-panel overflow-hidden relative bg-canvas">
      <FeedHeader tasks={tasks} onNewTask={openNewTask} hotkeyActive={!drawerOpen} />
      <CommandBar
        tasks={tasks}
        filterText={filterText}
        onFilterChange={handleFilterChange}
        onExecuteCommand={handleExecuteCommand}
        onSelectTask={handleSelectTask}
        inputRef={commandBarInputRef}
      />
      <div ref={feedBodyRef} className="flex-1 overflow-y-auto">
        <NavigationScope activeId={focusedId} containerRef={feedBodyRef} scrollSeq={scrollSeq}>
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
                invoke("workflow_approve", { taskId }).catch(console.error);
              }}
              onMerge={(taskId) => {
                invoke("workflow_merge_task", { taskId });
              }}
              onOpenPr={(taskId) => {
                invoke("workflow_open_pr", { taskId });
              }}
              onRowClick={onStripRowClick}
            />
          ))}
          {hasNoTasks && !filterText && (
            <EmptyState
              icon={Inbox}
              message="No tasks yet."
              description="Create a task to get started."
            />
          )}
          {hasNoFilterMatches && (
            <EmptyState
              icon={Inbox}
              message="No matching tasks."
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
        }}
      />
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
              await invoke("workflow_create_task", {
                title: "",
                description,
                baseBranch: baseBranch || null,
                autoMode,
                flow: flow ?? null,
              });
            }}
          />
        )}
      </ModalPanel>
      {gitHistoryOpen && <GitHistoryDrawer onClose={() => setGitHistoryOpen(false)} />}
      {activeTask && (
        <TaskDrawer
          task={activeTask}
          allTasks={tasks}
          onClose={() => setActiveTaskId(null)}
          onOpenTask={setActiveTaskId}
          onRejectModeChange={setRejectMode}
        />
      )}
    </div>
  );
}
