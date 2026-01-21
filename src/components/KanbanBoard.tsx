import { Task, TaskStatus, TASK_STATUS_CONFIG } from "../types/task";
import { TaskCard } from "./TaskCard";

interface KanbanBoardProps {
  tasks: Task[];
  onUpdateStatus: (id: string, status: TaskStatus) => Promise<Task>;
  selectedTaskId?: string;
  onSelectTask: (task: Task) => void;
}

const COLUMNS: TaskStatus[] = ["planning", "awaiting_approval", "in_progress", "ready_for_review", "done"];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  pending: "bg-gray-500",
  planning: "bg-purple-500",
  awaiting_approval: "bg-amber-500",
  in_progress: "bg-blue-500",
  ready_for_review: "bg-yellow-500",
  done: "bg-green-500",
  failed: "bg-red-500",
  blocked: "bg-orange-500",
};

export function KanbanBoard({ tasks, onUpdateStatus, selectedTaskId, onSelectTask }: KanbanBoardProps) {
  const getTasksForStatus = (status: TaskStatus) =>
    tasks.filter((task) => task.status === status);

  // Group tasks into columns
  const getTasksForColumn = (status: TaskStatus) => {
    if (status === "planning") {
      // Include pending, planning, failed, and blocked in the first column
      return [
        ...getTasksForStatus("pending"),
        ...getTasksForStatus("planning"),
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
                className={`w-3 h-3 rounded-full ${COLUMN_COLORS[status]}`}
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
