/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 * Navigation state is driven by DisplayContext.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFocusTaskListener } from "../hooks/useFocusTaskListener";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import {
  useAssistant,
  useAutoTaskTemplates,
  useDisplayContext,
  useTasks,
  useWorkflowConfig,
} from "../providers";
import type { AutoTaskTemplate, WorkflowTask, WorkflowTaskView } from "../types/workflow";
import { ArchivedListView } from "./ArchivedListView";
import { ArchiveTaskDetailView } from "./ArchiveTaskDetailView";
import { AssistantPanel, SessionHistory } from "./Assistant";
import { BranchIndicator } from "./BranchIndicator";
import { CommandPalette } from "./CommandPalette";
import { CommitDiffPanel, CommitHistoryPanel } from "./CommitHistory";
import { DiffPanel } from "./Diff";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelLayout, Slot } from "./ui";

export function Orkestra() {
  useNotificationPermission();
  useFocusTaskListener();

  const displayContext = useDisplayContext();
  const {
    view,
    focus,
    focusTask,
    focusSubtask,
    closeSubtask,
    openCreate,
    closeFocus,
    closeDiff,
    closeSubtaskDiff,
    openAssistant,
    closeAssistant,
    toggleAssistantHistory,
    closeAssistantHistory,
    switchToActive,
    switchToArchived,
    selectCommit,
    deselectCommit,
    exitCommits,
  } = displayContext;

  const config = useWorkflowConfig();
  const autoTaskTemplates = useAutoTaskTemplates();
  const { tasks, archivedTasks, loading, error, createTask, deleteTask } = useTasks();
  const { sessions, activeSession, selectSession } = useAssistant();

  // Filter to top-level tasks only
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);

  // Filter active tasks (non-archived top-level)
  const activeTasks = useMemo(
    () => topLevelTasks.filter((t) => !t.derived.is_archived),
    [topLevelTasks],
  );

  // Archived tasks now come from the provider directly
  const archivedTopLevelTasks = useMemo(
    () =>
      archivedTasks
        .filter((t) => !t.parent_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [archivedTasks],
  );

  // Select tasks based on current view
  const isArchiveView = view.type === "archive";

  // Look up selected task from both active and archived lists
  const currentSelectedTask: WorkflowTaskView | null = useMemo(() => {
    if (focus.type !== "task") return null;
    return (
      topLevelTasks.find((t) => t.id === focus.taskId) ??
      archivedTopLevelTasks.find((t) => t.id === focus.taskId) ??
      null
    );
  }, [focus, topLevelTasks, archivedTopLevelTasks]);

  // Derive subtasks for the selected parent from active or archived lists
  const currentSubtasks = useMemo(() => {
    if (!currentSelectedTask) return [];
    // If parent is archived, look in archived tasks for subtasks
    if (currentSelectedTask.derived.is_archived) {
      return archivedTasks.filter((t) => t.parent_id === currentSelectedTask.id);
    }
    // Otherwise look in active tasks
    return tasks.filter((t) => t.parent_id === currentSelectedTask.id);
  }, [currentSelectedTask, tasks, archivedTasks]);

  const selectedSubtaskId = focus.type === "task" ? focus.subtaskId : undefined;
  const showDiff = focus.type === "task" && focus.showDiff === true;
  const showSubtaskDiff = focus.type === "task" && focus.subtaskDiff === true;
  const assistantVisible = focus.type === "assistant";
  const assistantHistoryVisible = focus.type === "assistant" && focus.showHistory === true;
  const isCommitView = view.type === "commits";
  const selectedCommitHash = view.type === "commits" ? view.selectedCommit : undefined;

  const currentSelectedSubtask: WorkflowTaskView | null = selectedSubtaskId
    ? (currentSubtasks.find((t) => t.id === selectedSubtaskId) ?? null)
    : null;

  // Sidebar visibility and content key
  // Hide parent sidebar when subtask diff is open
  // Also guard against null task (shouldn't happen, but prevents empty sidebar)
  const sidebarVisible =
    (focus.type === "create" || (focus.type === "task" && currentSelectedTask !== null)) &&
    !showSubtaskDiff;
  const sidebarContentKey =
    focus.type === "create" ? "new-task" : focus.type === "task" ? focus.taskId : null;

  // Close detail panel when switching views
  const prevViewTypeRef = useRef(view.type);
  useEffect(() => {
    if (prevViewTypeRef.current !== view.type && focus.type === "task") {
      closeFocus();
    }
    prevViewTypeRef.current = view.type;
  }, [view.type, focus.type, closeFocus]);

  // Subtask panel visibility
  const subtaskVisible = !!currentSelectedSubtask;
  const subtaskContentKey = currentSelectedSubtask?.id ?? null;

  // Diff panel visibility
  const diffVisible = showDiff && !!currentSelectedTask;
  const subtaskDiffVisible = showSubtaskDiff && !!currentSelectedSubtask;

  const handleSelectTask = (task: WorkflowTask) => {
    focusTask(task.id);
  };

  const handleSelectSubtask = (subtask: WorkflowTaskView) => {
    if (focus.type === "task") {
      focusSubtask(focus.taskId, subtask.id);
    }
  };

  const handleCloseSubtask = () => {
    // When closing subtask, also close its diff if open
    if (showSubtaskDiff) {
      closeSubtaskDiff();
    }
    closeSubtask();
  };

  const handleDeleteTask = async (taskId: string) => {
    closeFocus();
    try {
      await deleteTask(taskId);
    } catch (err) {
      console.error("[handleDeleteTask] Delete failed, task will reappear:", err);
    }
  };

  const handleTaskCreated = async (
    description: string,
    autoMode: boolean,
    baseBranch: string | null,
    flow?: string,
  ) => {
    await createTask("", description, autoMode, baseBranch, flow);
    closeFocus();
  };

  const handleAutoTask = async (template: AutoTaskTemplate) => {
    await createTask(
      "",
      template.description,
      template.auto_run,
      undefined,
      template.flow ?? undefined,
    );
  };

  // Render sidebar content based on focus type and view
  const renderSidebarContent = () => {
    if (focus.type === "create") {
      return <NewTaskPanel onClose={closeFocus} onSubmit={handleTaskCreated} />;
    }
    if (currentSelectedTask) {
      if (isArchiveView) {
        // Read-only archive view
        return (
          <ArchiveTaskDetailView
            key={currentSelectedTask.id}
            task={currentSelectedTask}
            onClose={closeFocus}
            subtasks={currentSubtasks}
            selectedSubtaskId={selectedSubtaskId}
            onSelectSubtask={handleSelectSubtask}
          />
        );
      } else {
        // Active task view with actions
        return (
          <TaskDetailSidebar
            key={currentSelectedTask.id}
            task={currentSelectedTask}
            onClose={closeFocus}
            onDelete={() => handleDeleteTask(currentSelectedTask.id)}
            subtasks={currentSubtasks}
            selectedSubtaskId={selectedSubtaskId}
            onSelectSubtask={handleSelectSubtask}
          />
        );
      }
    }
    return null;
  };

  return (
    <div className="w-screen h-screen bg-stone-100 dark:bg-stone-950 flex flex-col items-stretch p-4 gap-4 overflow-hidden">
      <div className="flex items-center justify-between px-2 flex-shrink-0 overflow-hidden">
        <div className="flex items-center gap-4">
          <Panel.Title>Orkestra</Panel.Title>
          <Button
            variant={assistantVisible ? "primary" : "secondary"}
            size="sm"
            onClick={assistantVisible ? closeAssistant : openAssistant}
          >
            Assistant
          </Button>
          <div className="flex items-center gap-1 bg-stone-200 dark:bg-stone-800 rounded-panel p-0.5">
            <Button
              variant={view.type === "board" ? "primary" : "secondary"}
              size="sm"
              onClick={switchToActive}
            >
              Active
            </Button>
            <Button
              variant={view.type === "archive" ? "primary" : "secondary"}
              size="sm"
              onClick={switchToArchived}
            >
              Archived
            </Button>
          </div>
          <BranchIndicator />
        </div>
        <div className="flex items-center gap-2">
          {autoTaskTemplates.map((template) => (
            <Button
              key={template.filename}
              variant="secondary"
              size="sm"
              onClick={() => handleAutoTask(template)}
            >
              {template.title}
            </Button>
          ))}
          <Button onClick={openCreate}>+ New Task</Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel text-error-700 dark:text-error-300">
          Error loading tasks: {error}
        </div>
      )}

      <PanelLayout className="flex-1">
        {/* Assistant session history (LEFT side, leftmost) */}
        <Slot
          id="assistant-history"
          type="fixed"
          size={320}
          visible={assistantHistoryVisible}
          plain
        >
          {assistantHistoryVisible && (
            <SessionHistory
              sessions={sessions}
              activeSessionId={activeSession?.id ?? null}
              onSelectSession={(session) => {
                selectSession(session);
                closeAssistantHistory();
              }}
              onClose={closeAssistantHistory}
            />
          )}
        </Slot>

        {/* Assistant panel (LEFT side) */}
        <Slot id="assistant" type="fixed" size={480} visible={assistantVisible} plain>
          {assistantVisible && (
            <AssistantPanel onClose={closeAssistant} onToggleHistory={toggleAssistantHistory} />
          )}
        </Slot>

        {/* Commit history list (fixed width, visible in commit view) */}
        <Slot id="commit-list" type="fixed" size={360} visible={isCommitView}>
          <CommitHistoryPanel
            selectedCommit={selectedCommitHash}
            onSelectCommit={selectCommit}
            onClose={exitCommits}
          />
        </Slot>

        {/* Commit diff (grow, visible when a commit is selected) */}
        <Slot id="commit-diff" type="grow" visible={isCommitView && !!selectedCommitHash}>
          {selectedCommitHash && (
            <CommitDiffPanel commitHash={selectedCommitHash} onClose={deselectCommit} />
          )}
        </Slot>

        {/* Main content: KanbanBoard or ArchivedListView (hides when diff or subtask diff is shown) */}
        {/* Note: When visible=false, the ternary content below is not rendered. The logic must ensure
             the board is completely hidden when it shouldn't be shown, not just when specific conditions
             are met. Partial visibility conditions (like "hide only when X is selected") can cause the
             wrong content to render when the slot becomes visible again. */}
        <Slot
          id="board"
          type="grow"
          visible={!showDiff && !showSubtaskDiff && !loading && !isCommitView}
        >
          {view.type === "archive" ? (
            <ArchivedListView
              tasks={archivedTopLevelTasks}
              selectedTaskId={currentSelectedTask?.id}
              onSelectTask={handleSelectTask}
            />
          ) : (
            <KanbanBoard
              config={config}
              tasks={activeTasks}
              selectedTaskId={currentSelectedTask?.id}
              onSelectTask={handleSelectTask}
            />
          )}
        </Slot>

        {/* Sidebar: NewTaskPanel or TaskDetailSidebar */}
        <Slot
          id="sidebar"
          type="fixed"
          size={480}
          visible={sidebarVisible}
          contentKey={sidebarContentKey}
          plain
        >
          {sidebarVisible && renderSidebarContent()}
        </Slot>

        {/* Subtask detail panel */}
        <Slot
          id="subtask"
          type="fixed"
          size={480}
          visible={subtaskVisible}
          contentKey={subtaskContentKey}
          plain
        >
          {subtaskVisible && currentSelectedSubtask && (
            <TaskDetailSidebar
              key={currentSelectedSubtask.id}
              task={currentSelectedSubtask}
              onClose={handleCloseSubtask}
            />
          )}
        </Slot>

        {/* Diff panel (shows when diff is open, board hides) */}
        <Slot id="diff" type="grow" visible={diffVisible}>
          {diffVisible && currentSelectedTask && (
            <DiffPanel taskId={currentSelectedTask.id} onClose={closeDiff} />
          )}
        </Slot>

        {/* Subtask diff panel (shows when subtask diff is open, board and parent sidebar hide) */}
        <Slot id="subtask-diff" type="grow" visible={subtaskDiffVisible}>
          {subtaskDiffVisible && currentSelectedSubtask && (
            <DiffPanel taskId={currentSelectedSubtask.id} onClose={closeSubtaskDiff} />
          )}
        </Slot>
      </PanelLayout>

      <CommandPalette />
    </div>
  );
}
