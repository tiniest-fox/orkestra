import { Task, TaskStatus, TASK_STATUS_CONFIG } from "../types/task";
import { TaskCard } from "./TaskCard";

interface KanbanBoardProps {
  tasks: Task[];
  onUpdateStatus: (id: string, status: TaskStatus) => Promise<Task>;
  selectedTaskId?: string;
  onSelectTask: (task: Task) => void;
}

const COLUMNS: TaskStatus[] = ["pending", "in_progress", "ready_for_review", "done"];

export function KanbanBoard({ tasks, onUpdateStatus, selectedTaskId, onSelectTask }: KanbanBoardProps) {
  const getTasksForStatus = (status: TaskStatus) =>
    tasks.filter((task) => task.status === status);

  // Show failed and blocked tasks in the pending column with special styling
  const getTasksForColumn = (status: TaskStatus) => {
    if (status === "pending") {
      return [
        ...getTasksForStatus("pending"),
        ...getTasksForStatus("failed"),
        ...getTasksForStatus("blocked"),
      ];
    }
    return getTasksForStatus(status);
  };

  const handleMarkDone = async (taskId: string) => {
    try {
      await onUpdateStatus(taskId, "done");
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map((status) => {
        const columnTasks = getTasksForColumn(status);
        return (
          <div
            key={status}
            className="flex-shrink-0 w-72 bg-gray-50 rounded-lg p-4"
          >
            <h2 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  status === "pending" ? "bg-gray-500" :
                  status === "in_progress" ? "bg-blue-500" :
                  status === "ready_for_review" ? "bg-yellow-500" :
                  "bg-green-500"
                }`}
              />
              {TASK_STATUS_CONFIG[status].label}
              <span className="text-gray-400 text-sm">
                ({columnTasks.length})
              </span>
            </h2>
            <div className="space-y-3">
              {columnTasks.length === 0 ? (
                <div className="text-gray-400 text-sm text-center py-8">
                  No tasks
                </div>
              ) : (
                columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => onSelectTask(task)}
                    isSelected={task.id === selectedTaskId}
                    onMarkDone={
                      task.status === "ready_for_review"
                        ? () => handleMarkDone(task.id)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
