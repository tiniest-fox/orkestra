/**
 * Kanban column - single column in the kanban board.
 */

import type { WorkflowTaskView } from "../../types/workflow";
import type { KanbanColumn as KanbanColumnType } from "../../utils/kanban";
import { Panel, PanelContainer } from "../ui";
import { TaskCard } from "./TaskCard";

interface KanbanColumnProps {
  column: KanbanColumnType;
  tasks: WorkflowTaskView[];
  selectedTaskId?: string;
  onSelectTask: (task: WorkflowTaskView) => void;
}

export function KanbanColumn({ column, tasks, selectedTaskId, onSelectTask }: KanbanColumnProps) {
  return (
    <Panel autoFill={false} className="my-2 w-72 shrink-0">
      <h2 className="font-heading font-medium px-4 pt-4 text-stone-700 flex items-center gap-2 flex-shrink-0">
        <span className={`w-3 h-3 rounded-full ${column.color}`} />
        {column.label}
        <span className="text-stone-400 text-sm">({tasks.length})</span>
      </h2>
      <PanelContainer direction="vertical" scrolls={true} padded={true}>
        <div />
        {tasks.length === 0 ? (
          <div className="text-stone-400 text-sm text-center py-8">No tasks</div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onSelectTask(task)}
              isSelected={task.id === selectedTaskId}
            />
          ))
        )}
      </PanelContainer>
    </Panel>
  );
}
