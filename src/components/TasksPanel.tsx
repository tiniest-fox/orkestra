/**
 * TasksPanel - Main panel containing the Kanban board.
 * Wraps WorkflowKanbanBoard in a Panel with the design system styling.
 */

import type { WorkflowConfig, WorkflowTask } from "../types/workflow";
import { Panel } from "./ui";
import { WorkflowKanbanBoard } from "./WorkflowKanbanBoard";

interface TasksPanelProps {
  config: WorkflowConfig;
  tasks: WorkflowTask[];
  selectedTaskId?: string;
  onSelectTask: (task: WorkflowTask) => void;
}

export function TasksPanel({ config, tasks, selectedTaskId, onSelectTask }: TasksPanelProps) {
  return (
    <Panel className="h-full flex flex-col" variant="default">
      <div className="flex-1 overflow-hidden">
        <WorkflowKanbanBoard
          config={config}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
        />
      </div>
    </Panel>
  );
}
