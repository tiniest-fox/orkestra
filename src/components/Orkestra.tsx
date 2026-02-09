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
    layout,
    showTask,
    showSubtask,
    closeSubtask,
    showNewTask,
    closeFocus,
    closeDiff,
    toggleAssistant,
    toggleAssistantHistory,
    closeAssistantHistory,
    switchToActive,
    switchToArchive,
    selectCommit,
    deselectCommit,
    toggleGitHistory,
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
  const isArchiveView = layout.isArchive;

  // Look up selected task from both active and archived lists
  const currentSelectedTask: WorkflowTaskView | null = useMemo(() => {
    if (!layout.taskId) return null;
    return (
      topLevelTasks.find((t) => t.id === layout.taskId) ??
      archivedTopLevelTasks.find((t) => t.id === layout.taskId) ??
      null
    );
  }, [layout.taskId, topLevelTasks, archivedTopLevelTasks]);

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

  const selectedSubtaskId = layout.subtaskId;
  const showDiff = layout.preset === "TaskDiff";
  const showSubtaskDiff = layout.preset === "SubtaskDiff";
  const assistantVisible = layout.preset === "Assistant" || layout.preset === "AssistantHistory";
  const assistantHistoryVisible = layout.preset === "AssistantHistory";
  const isCommitView = layout.preset === "GitHistory" || layout.preset === "GitCommit";
  const selectedCommitHash = layout.commitHash;

  const currentSelectedSubtask: WorkflowTaskView | null = selectedSubtaskId
    ? (currentSubtasks.find((t) => t.id === selectedSubtaskId) ?? null)
    : null;

  // Sidebar visibility and content key
  // Hide parent sidebar when subtask diff is open
  // Also guard against null task (shouldn't happen, but prevents empty sidebar)
  const sidebarVisible =
    (layout.preset === "NewTask" ||
      ((layout.preset === "Task" || layout.preset === "Subtask") &&
        currentSelectedTask !== null)) &&
    !showSubtaskDiff;
  const sidebarContentKey =
    layout.preset === "NewTask"
      ? "new-task"
      : layout.preset === "Task" || layout.preset === "Subtask"
        ? layout.taskId
        : null;

  // Close detail panel when switching archive state
  const prevIsArchiveRef = useRef(layout.isArchive);
  useEffect(() => {
    if (prevIsArchiveRef.current !== layout.isArchive && layout.taskId) {
      closeFocus();
    }
    prevIsArchiveRef.current = layout.isArchive;
  }, [layout.isArchive, layout.taskId, closeFocus]);

  // Subtask panel visibility
  const subtaskVisible = !!currentSelectedSubtask;
  const subtaskContentKey = currentSelectedSubtask?.id ?? null;

  // Diff panel visibility
  const diffVisible = showDiff && !!currentSelectedTask;
  const subtaskDiffVisible = showSubtaskDiff && !!currentSelectedSubtask;

  const handleSelectTask = (task: WorkflowTask) => {
    showTask(task.id);
  };

  const handleSelectSubtask = (subtask: WorkflowTaskView) => {
    if (layout.taskId) {
      showSubtask(layout.taskId, subtask.id);
    }
  };

  const handleCloseSubtask = () => {
    // When closing subtask, also close its diff if open
    if (showSubtaskDiff) {
      closeDiff();
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

  // Render sidebar content based on preset
  const renderSidebarContent = () => {
    if (layout.preset === "NewTask") {
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
            selectedSubtaskId={selectedSubtaskId ?? undefined}
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
            selectedSubtaskId={selectedSubtaskId ?? undefined}
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
            onClick={toggleAssistant}
          >
            Assistant
          </Button>
          <div className="flex items-center gap-1 bg-stone-200 dark:bg-stone-800 rounded-panel p-0.5">
            <Button
              variant={!layout.isArchive ? "primary" : "secondary"}
              size="sm"
              onClick={switchToActive}
            >
              Active
            </Button>
            <Button
              variant={layout.isArchive ? "primary" : "secondary"}
              size="sm"
              onClick={switchToArchive}
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
          <Button onClick={showNewTask}>+ New Task</Button>
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
            <AssistantPanel onClose={toggleAssistant} onToggleHistory={toggleAssistantHistory} />
          )}
        </Slot>

        {/* Commit history list (fixed width, visible in commit view) */}
        <Slot id="commit-list" type="fixed" size={360} visible={isCommitView}>
          <CommitHistoryPanel
            selectedCommit={selectedCommitHash ?? undefined}
            onSelectCommit={selectCommit}
            onClose={toggleGitHistory}
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
          {layout.isArchive ? (
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
            <DiffPanel taskId={currentSelectedSubtask.id} onClose={closeDiff} />
          )}
        </Slot>
      </PanelLayout>

      <CommandPalette />
    </div>
  );
}
