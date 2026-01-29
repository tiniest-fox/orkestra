/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 */

import { useState } from "react";
import { useWorkflowConfig, useWorkflowTasks } from "../hooks/useWorkflow";
import type { WorkflowTask } from "../types/workflow";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelContainer, PanelSlot } from "./ui";

type SidebarView = { type: "none" } | { type: "create" } | { type: "task"; task: WorkflowTask };

export function Orkestra() {
  const [sidebarView, setSidebarView] = useState<SidebarView>({ type: "none" });

  const { config, loading: configLoading, error: configError } = useWorkflowConfig();
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    createTask,
    deleteTask,
    refetch,
  } = useWorkflowTasks();

  const loading = configLoading || tasksLoading;
  const error = configError || tasksError;

  const currentSelectedTask =
    sidebarView.type === "task"
      ? tasks.find((t) => t.id === sidebarView.task.id) || sidebarView.task
      : null;

  const sidebarActiveKey =
    sidebarView.type === "create"
      ? "create"
      : sidebarView.type === "task"
        ? `task-${currentSelectedTask?.id}`
        : null;

  const handleSelectTask = (task: WorkflowTask) => {
    setSidebarView({ type: "task", task });
  };

  const handleOpenCreatePanel = () => {
    setSidebarView({ type: "create" });
  };

  const handleCloseSidebar = () => {
    setSidebarView({ type: "none" });
  };

  const handleDeleteTask = async (taskId: string) => {
    handleCloseSidebar();
    await deleteTask(taskId);
  };

  const handleTaskCreated = async (description: string) => {
    const newTask = await createTask("", description);
    if (newTask && typeof newTask === "object" && "id" in newTask) {
      setSidebarView({ type: "task", task: newTask as WorkflowTask });
    } else {
      handleCloseSidebar();
    }
  };

  return (
    <div className="w-screen h-screen bg-stone-100 flex flex-col items-stretch p-4 gap-4">
      <div className="flex items-center justify-between px-2 flex-shrink-0">
        <Panel.Title>Orkestra</Panel.Title>
        <Button onClick={handleOpenCreatePanel}>+ New Task</Button>
      </div>

      <PanelContainer>
        {error && (
          <div className="mb-4 p-4 bg-error-50 border border-error-200 rounded-panel text-error-700">
            Error loading tasks: {error.message}
          </div>
        )}
        {loading || !config ? (
          <Panel>
            <div className="flex items-center justify-center h-64">
              <div className="text-stone-500">Loading...</div>
            </div>
          </Panel>
        ) : (
          <Panel>
            <KanbanBoard
              config={config}
              tasks={tasks}
              selectedTaskId={currentSelectedTask?.id}
              onSelectTask={handleSelectTask}
            />
          </Panel>
        )}

        <PanelSlot activeKey={sidebarActiveKey}>
          <PanelSlot.Panel panelKey="create">
            <NewTaskPanel onClose={handleCloseSidebar} onSubmit={handleTaskCreated} />
          </PanelSlot.Panel>

          {currentSelectedTask && config && (
            <PanelSlot.Panel panelKey={`task-${currentSelectedTask.id}`}>
              <TaskDetailSidebar
                task={currentSelectedTask}
                config={config}
                onClose={handleCloseSidebar}
                onDelete={() => handleDeleteTask(currentSelectedTask.id)}
                onTaskUpdated={refetch}
              />
            </PanelSlot.Panel>
          )}
        </PanelSlot>
      </PanelContainer>
    </div>
  );
}
