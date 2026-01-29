import { useState } from "react";
import { useWorkflow } from "../hooks/useWorkflow";
import type { WorkflowTask } from "../types/workflow";
import { NewTaskPanel } from "./NewTaskPanel";
import { TasksPanel } from "./TasksPanel";
import { Button, Panel, PanelContainer, PanelSlot } from "./ui";
import { WorkflowTaskDetailSidebar } from "./WorkflowTaskDetailSidebar";

type SidebarView = { type: "none" } | { type: "create" } | { type: "task"; task: WorkflowTask };

/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 */
export function Orkestra() {
  const [sidebarView, setSidebarView] = useState<SidebarView>({ type: "none" });

  const { config, tasks, loading, error, createTask, refetch } = useWorkflow();

  // Keep selected task in sync with latest data
  const currentSelectedTask =
    sidebarView.type === "task"
      ? tasks.find((t) => t.id === sidebarView.task.id) || sidebarView.task
      : null;

  // Derive activeKey for PanelSlot
  const sidebarActiveKey =
    sidebarView.type === "create"
      ? "create"
      : sidebarView.type === "task"
        ? `task-${currentSelectedTask?.id}`
        : null;

  // Handlers
  const handleSelectTask = (task: WorkflowTask) => {
    setSidebarView({ type: "task", task });
  };

  const handleOpenCreatePanel = () => {
    setSidebarView({ type: "create" });
  };

  const handleCloseSidebar = () => {
    setSidebarView({ type: "none" });
  };

  const handleTaskCreated = async (description: string) => {
    const newTask = await createTask("", description);
    // Transition to the newly created task's detail view
    if (newTask && typeof newTask === "object" && "id" in newTask) {
      setSidebarView({ type: "task", task: newTask as WorkflowTask });
    } else {
      handleCloseSidebar();
    }
  };

  return (
    <div className="w-screen h-screen bg-stone-100 flex flex-col items-stretch p-4 gap-4">
      {/* Header as standalone Panel */}
      <div className="flex items-center justify-between px-2 flex-shrink-0">
        <Panel.Title>Orkestra</Panel.Title>
        <Button onClick={handleOpenCreatePanel}>+ New Task</Button>
      </div>

      {/* Main content area - PanelContainer auto-fills with flex-1 */}
      <PanelContainer>
        {/* Main content panel (Kanban board) */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-panel text-error">
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
          <TasksPanel
            config={config}
            tasks={tasks}
            selectedTaskId={currentSelectedTask?.id}
            onSelectTask={handleSelectTask}
          />
        )}

        {/* Sidebar slot for create/detail panels */}
        <PanelSlot activeKey={sidebarActiveKey}>
          <PanelSlot.Panel panelKey="create">
            <NewTaskPanel onClose={handleCloseSidebar} onSubmit={handleTaskCreated} />
          </PanelSlot.Panel>

          {currentSelectedTask && config && (
            <PanelSlot.Panel panelKey={`task-${currentSelectedTask.id}`}>
              <WorkflowTaskDetailSidebar
                task={currentSelectedTask}
                config={config}
                onClose={handleCloseSidebar}
                onTaskUpdated={refetch}
              />
            </PanelSlot.Panel>
          )}
        </PanelSlot>
      </PanelContainer>
    </div>
  );
}
