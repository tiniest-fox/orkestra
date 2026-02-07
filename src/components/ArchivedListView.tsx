/**
 * Archived list view - displays archived tasks in a read-only list.
 *
 * Reuses TaskCard with "subtask" variant for consistent styling.
 * No progress bar (archived tasks don't need progress tracking).
 */

import type { WorkflowTaskView } from "../types/workflow";
import { TaskCard } from "./Kanban/TaskCard";
import { Panel } from "./ui";

interface ArchivedListViewProps {
  /** Filtered archived tasks (top-level only). */
  tasks: WorkflowTaskView[];
  /** Current selected task ID. */
  selectedTaskId?: string;
  /** Called when user clicks a task. */
  onSelectTask: (task: WorkflowTaskView) => void;
}

export function ArchivedListView({ tasks, selectedTaskId, onSelectTask }: ArchivedListViewProps) {
  return (
    <Panel>
      <div className="p-4">
        {tasks.length === 0 ? (
          <div className="text-stone-500 dark:text-stone-400 text-sm">No archived tasks.</div>
        ) : (
          <div className="space-y-2 flex flex-col items-stretch">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                variant="subtask"
                isSelected={task.id === selectedTaskId}
                onClick={() => onSelectTask(task)}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
