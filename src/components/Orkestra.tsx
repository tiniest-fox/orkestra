/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 * Navigation state is driven by DisplayContext.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useAutoTaskTemplates, useDisplayContext, useTasks, useWorkflowConfig } from "../providers";
import type { AutoTaskTemplate, WorkflowTask, WorkflowTaskView } from "../types/workflow";
import { ArchivedListView } from "./ArchivedListView";
import { ArchiveTaskDetailView } from "./ArchiveTaskDetailView";
import { CommandPalette } from "./CommandPalette";
import { DiffPanel } from "./Diff";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelLayout, Slot } from "./ui";

export function Orkestra() {
  useNotificationPermission();

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
    switchToActive,
    switchToArchived,
  } = displayContext;

  // Track sidebar open/close cycles to force fresh state on reopen
  const [sidebarSessionCounter, setSidebarSessionCounter] = useState(0);
  const [subtaskSessionCounter, setSubtaskSessionCounter] = useState(0);

  const config = useWorkflowConfig();
  const autoTaskTemplates = useAutoTaskTemplates();
  const { tasks, loading, error, createTask, deleteTask } = useTasks();

  // Filter to top-level tasks only
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);

  // Filter active tasks (non-archived top-level)
  const activeTasks = useMemo(
    () => topLevelTasks.filter((t) => !t.derived.is_archived),
    [topLevelTasks],
  );

  // Filter archived tasks (archived top-level)
  const archivedTasks = useMemo(
    () => topLevelTasks.filter((t) => t.derived.is_archived),
    [topLevelTasks],
  );

  // Select tasks based on current view
  const isArchiveView = view.type === "archive";

  const currentSelectedTask: WorkflowTaskView | null =
    focus.type === "task" ? (topLevelTasks.find((t) => t.id === focus.taskId) ?? null) : null;

  // Derive subtasks for the selected parent from the shared task list
  const currentSubtasks = useMemo(
    () => (currentSelectedTask ? tasks.filter((t) => t.parent_id === currentSelectedTask.id) : []),
    [tasks, currentSelectedTask],
  );

  const selectedSubtaskId = focus.type === "task" ? focus.subtaskId : undefined;
  const showDiff = focus.type === "task" && focus.showDiff === true;
  const showSubtaskDiff = focus.type === "task" && focus.subtaskDiff === true;

  const currentSelectedSubtask: WorkflowTaskView | null = selectedSubtaskId
    ? (currentSubtasks.find((t) => t.id === selectedSubtaskId) ?? null)
    : null;

  // Track visibility changes to increment session counter when reopening
  const prevSidebarVisibleRef = useRef(false);
  useEffect(() => {
    const currentVisible = (focus.type === "create" || focus.type === "task") && !showSubtaskDiff;
    // If transitioning from hidden to visible, increment counter to force fresh state
    if (!prevSidebarVisibleRef.current && currentVisible) {
      setSidebarSessionCounter((prev) => prev + 1);
    }
    prevSidebarVisibleRef.current = currentVisible;
  }, [focus.type, showSubtaskDiff]);

  // Sidebar visibility and content key
  // Hide parent sidebar when subtask diff is open
  const sidebarVisible = (focus.type === "create" || focus.type === "task") && !showSubtaskDiff;
  const sidebarContentKey =
    focus.type === "create" ? "new-task" : focus.type === "task" ? focus.taskId : null;

  // Track subtask visibility changes to increment session counter when reopening
  const prevSubtaskVisibleRef = useRef(false);
  useEffect(() => {
    const currentVisible = !!currentSelectedSubtask;
    // If transitioning from hidden to visible, increment counter to force fresh state
    if (!prevSubtaskVisibleRef.current && currentVisible) {
      setSubtaskSessionCounter((prev) => prev + 1);
    }
    prevSubtaskVisibleRef.current = currentVisible;
  }, [currentSelectedSubtask]);

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
  // Use sidebarSessionCounter as key to force remount on reopen (clears all state)
  const renderSidebarContent = () => {
    if (focus.type === "create") {
      return (
        <NewTaskPanel
          key={sidebarSessionCounter}
          onClose={closeFocus}
          onSubmit={handleTaskCreated}
        />
      );
    }
    if (currentSelectedTask) {
      if (isArchiveView) {
        // Read-only archive view
        return (
          <ArchiveTaskDetailView
            key={`${currentSelectedTask.id}-${sidebarSessionCounter}`}
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
            key={`${currentSelectedTask.id}-${sidebarSessionCounter}`}
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
        {/* Main content: KanbanBoard or ArchivedListView (hides when diff or subtask diff is shown) */}
        <Slot id="board" type="grow" visible={!showDiff && !showSubtaskDiff && !loading}>
          {view.type === "board" ? (
            <KanbanBoard
              config={config}
              tasks={activeTasks}
              selectedTaskId={currentSelectedTask?.id}
              onSelectTask={handleSelectTask}
            />
          ) : (
            <ArchivedListView
              tasks={archivedTasks}
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
          {renderSidebarContent()}
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
          {currentSelectedSubtask && (
            <TaskDetailSidebar
              key={`${currentSelectedSubtask.id}-${subtaskSessionCounter}`}
              task={currentSelectedSubtask}
              onClose={handleCloseSubtask}
            />
          )}
        </Slot>

        {/* Diff panel (shows when diff is open, board hides) */}
        <Slot id="diff" type="grow" visible={diffVisible}>
          {currentSelectedTask && <DiffPanel taskId={currentSelectedTask.id} onClose={closeDiff} />}
        </Slot>

        {/* Subtask diff panel (shows when subtask diff is open, board and parent sidebar hide) */}
        <Slot id="subtask-diff" type="grow" visible={subtaskDiffVisible}>
          {currentSelectedSubtask && (
            <DiffPanel taskId={currentSelectedSubtask.id} onClose={closeSubtaskDiff} />
          )}
        </Slot>
      </PanelLayout>

      <CommandPalette />
    </div>
  );
}
