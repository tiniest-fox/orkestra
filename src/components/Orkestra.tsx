/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 * Navigation state is driven by DisplayContext.
 */

import { useMemo } from "react";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useAutoTaskTemplates, useDisplayContext, useTasks, useWorkflowConfig } from "../providers";
import type { AutoTaskTemplate, WorkflowTask, WorkflowTaskView } from "../types/workflow";
import { CommandPalette } from "./CommandPalette";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelContainer, PanelSlot, SidebarSlot, SubtaskSlot } from "./ui";

export function Orkestra() {
  useNotificationPermission();

  const { focus, focusTask, focusSubtask, closeSubtask, openCreate, closeFocus } =
    useDisplayContext();

  const config = useWorkflowConfig();
  const autoTaskTemplates = useAutoTaskTemplates();
  const { tasks, loading, error, createTask, deleteTask } = useTasks();

  // Filter to top-level tasks only for the kanban board
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);

  const currentSelectedTask: WorkflowTaskView | null =
    focus.type === "task" ? (topLevelTasks.find((t) => t.id === focus.taskId) ?? null) : null;

  // Derive subtasks for the selected parent from the shared task list
  const currentSubtasks = useMemo(
    () => (currentSelectedTask ? tasks.filter((t) => t.parent_id === currentSelectedTask.id) : []),
    [tasks, currentSelectedTask],
  );

  const selectedSubtaskId = focus.type === "task" ? focus.subtaskId : undefined;
  const showDiff = focus.type === "task" && focus.showDiff === true;

  const currentSelectedSubtask: WorkflowTaskView | null =
    selectedSubtaskId && !showDiff
      ? (currentSubtasks.find((t) => t.id === selectedSubtaskId) ?? null)
      : null;

  const sidebarActiveKey =
    focus.type === "create"
      ? SidebarSlot.NewTask
      : currentSelectedTask
        ? SidebarSlot.task(currentSelectedTask.id)
        : null;

  // Subtask panel is hidden when diff panel is open (mutual exclusion)
  const subtaskActiveKey =
    !showDiff && currentSelectedSubtask ? SubtaskSlot.subtask(currentSelectedSubtask.id) : null;

  const handleSelectTask = (task: WorkflowTask) => {
    focusTask(task.id);
  };

  const handleSelectSubtask = (subtask: WorkflowTaskView) => {
    if (focus.type === "task") {
      focusSubtask(focus.taskId, subtask.id);
    }
  };

  const handleCloseSubtask = () => {
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

  return (
    <div className="w-screen h-screen bg-stone-100 dark:bg-stone-950 flex flex-col items-stretch p-4 gap-4 overflow-hidden">
      <div className="flex items-center justify-between px-2 flex-shrink-0 overflow-hidden">
        <Panel.Title>Orkestra</Panel.Title>
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

      <PanelContainer>
        {error && (
          <div className="mb-4 p-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel text-error-700 dark:text-error-300">
            Error loading tasks: {error}
          </div>
        )}
        {loading ? (
          <Panel>{null}</Panel>
        ) : showDiff ? (
          <Panel>
            <div className="flex items-center justify-center h-full text-stone-500">Diff panel</div>
          </Panel>
        ) : (
          <Panel>
            <KanbanBoard
              config={config}
              tasks={topLevelTasks}
              selectedTaskId={currentSelectedTask?.id}
              onSelectTask={handleSelectTask}
            />
          </Panel>
        )}

        <PanelSlot activeKey={sidebarActiveKey}>
          <PanelSlot.Panel panelKey={SidebarSlot.NewTask}>
            <NewTaskPanel onClose={closeFocus} onSubmit={handleTaskCreated} />
          </PanelSlot.Panel>

          {currentSelectedTask && (
            <PanelSlot.Panel panelKey={SidebarSlot.task(currentSelectedTask.id)}>
              <TaskDetailSidebar
                task={currentSelectedTask}
                onClose={closeFocus}
                onDelete={() => handleDeleteTask(currentSelectedTask.id)}
                subtasks={currentSubtasks}
                selectedSubtaskId={selectedSubtaskId}
                onSelectSubtask={handleSelectSubtask}
              />
            </PanelSlot.Panel>
          )}
        </PanelSlot>

        <PanelSlot activeKey={subtaskActiveKey}>
          {currentSelectedSubtask && (
            <PanelSlot.Panel panelKey={SubtaskSlot.subtask(currentSelectedSubtask.id)}>
              <TaskDetailSidebar task={currentSelectedSubtask} onClose={handleCloseSubtask} />
            </PanelSlot.Panel>
          )}
        </PanelSlot>
      </PanelContainer>

      <CommandPalette />
    </div>
  );
}
