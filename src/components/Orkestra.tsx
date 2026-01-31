/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 */

import { useMemo, useState } from "react";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useTasks, useWorkflowConfig } from "../providers";
import type { WorkflowTask, WorkflowTaskView } from "../types/workflow";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelContainer, PanelSlot, SidebarSlot, SubtaskSlot } from "./ui";

type SidebarView =
  | { type: "none" }
  | { type: "create" }
  | { type: "task"; taskId: string; subtaskId?: string };

export function Orkestra() {
  useNotificationPermission();
  const [sidebarView, setSidebarView] = useState<SidebarView>({ type: "none" });

  const config = useWorkflowConfig();
  const { tasks, loading, error, createTask, deleteTask } = useTasks();

  // Filter to top-level tasks only for the kanban board
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);

  const currentSelectedTask: WorkflowTaskView | null =
    sidebarView.type === "task"
      ? (topLevelTasks.find((t) => t.id === sidebarView.taskId) ?? null)
      : null;

  // Derive subtasks for the selected parent from the shared task list
  const currentSubtasks = useMemo(
    () =>
      currentSelectedTask ? tasks.filter((t) => t.parent_id === currentSelectedTask.id) : [],
    [tasks, currentSelectedTask],
  );

  const selectedSubtaskId =
    sidebarView.type === "task" ? sidebarView.subtaskId : undefined;

  const currentSelectedSubtask: WorkflowTaskView | null =
    selectedSubtaskId
      ? (currentSubtasks.find((t) => t.id === selectedSubtaskId) ?? null)
      : null;

  const sidebarActiveKey =
    sidebarView.type === "create"
      ? SidebarSlot.NewTask
      : currentSelectedTask
        ? SidebarSlot.task(currentSelectedTask.id)
        : null;

  const subtaskActiveKey = currentSelectedSubtask
    ? SubtaskSlot.subtask(currentSelectedSubtask.id)
    : null;

  const handleSelectTask = (task: WorkflowTask) => {
    setSidebarView({ type: "task", taskId: task.id });
  };

  const handleSelectSubtask = (subtask: WorkflowTaskView) => {
    if (sidebarView.type === "task") {
      setSidebarView({ ...sidebarView, subtaskId: subtask.id });
    }
  };

  const handleCloseSubtask = () => {
    if (sidebarView.type === "task") {
      setSidebarView({ type: "task", taskId: sidebarView.taskId });
    }
  };

  const handleOpenCreatePanel = () => {
    setSidebarView({ type: "create" });
  };

  const handleCloseSidebar = () => {
    setSidebarView({ type: "none" });
  };

  const handleDeleteTask = async (taskId: string) => {
    handleCloseSidebar();
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
    handleCloseSidebar();
  };

  return (
    <div className="w-screen h-screen bg-stone-100 dark:bg-stone-950 flex flex-col items-stretch p-4 gap-4 overflow-hidden">
      <div className="flex items-center justify-between px-2 flex-shrink-0 overflow-hidden">
        <Panel.Title>Orkestra</Panel.Title>
        <Button onClick={handleOpenCreatePanel}>+ New Task</Button>
      </div>

      <PanelContainer>
        {error && (
          <div className="mb-4 p-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel text-error-700 dark:text-error-300">
            Error loading tasks: {error}
          </div>
        )}
        {loading ? (
          <Panel>
            <div className="flex items-center justify-center h-64">
              <div className="text-stone-500 dark:text-stone-400">Loading...</div>
            </div>
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
            <NewTaskPanel onClose={handleCloseSidebar} onSubmit={handleTaskCreated} />
          </PanelSlot.Panel>

          {currentSelectedTask && (
            <PanelSlot.Panel panelKey={SidebarSlot.task(currentSelectedTask.id)}>
              <TaskDetailSidebar
                task={currentSelectedTask}
                onClose={handleCloseSidebar}
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
              <TaskDetailSidebar
                task={currentSelectedSubtask}
                onClose={handleCloseSubtask}
              />
            </PanelSlot.Panel>
          )}
        </PanelSlot>
      </PanelContainer>
    </div>
  );
}
