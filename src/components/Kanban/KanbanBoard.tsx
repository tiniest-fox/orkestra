/**
 * Kanban board - displays tasks organized by workflow stage.
 */

import type { WorkflowConfig, WorkflowTask } from "../../types/workflow";
import { buildColumns, getTasksForColumn } from "../../utils/kanban";
import { PanelContainer } from "../ui";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
  config: WorkflowConfig;
  tasks: WorkflowTask[];
  selectedTaskId?: string;
  onSelectTask: (task: WorkflowTask) => void;
}

export function KanbanBoard({ config, tasks, selectedTaskId, onSelectTask }: KanbanBoardProps) {
  const columns = buildColumns(config);
  const visibleTasks = tasks.filter((task) => !task.parent_id);

  return (
    <PanelContainer scrolls={true}>
      <div />
      {columns.map((column) => {
        const columnTasks = getTasksForColumn(visibleTasks, column.id);
        return (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={columnTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
          />
        );
      })}
      <div className="w-px" />
    </PanelContainer>
  );
}
