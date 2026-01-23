import { TASK_STATUS_CONFIG, type Task, type TaskStatus } from "../types/task";
import { TaskCard } from "./TaskCard";

interface KanbanBoardProps {
  tasks: Task[];
  onUpdateStatus: (id: string, status: TaskStatus) => Promise<Task>;
  selectedTaskId?: string;
  onSelectTask: (task: Task) => void;
}

// 5 main columns - failed/blocked tasks stay inline in their relevant column
const COLUMNS: TaskStatus[] = ["planning", "breaking_down", "working", "reviewing", "done"];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  planning: "bg-purple-500",
  breaking_down: "bg-indigo-500",
  waiting_on_subtasks: "bg-cyan-500",
  working: "bg-blue-500",
  reviewing: "bg-violet-500",
  done: "bg-green-500",
  failed: "bg-red-500",
  blocked: "bg-orange-500",
};

// Helper to check if a task needs review
const needsReview = (task: Task): boolean => {
  return (
    (task.status === "planning" && task.plan !== undefined) ||
    (task.status === "breaking_down" && task.breakdown !== undefined) ||
    (task.status === "working" && task.summary !== undefined)
  );
};

export function KanbanBoard({ tasks, selectedTaskId, onSelectTask }: KanbanBoardProps) {
  // Filter to show only:
  // - Tasks with kind === "task" (not checklist subtasks)
  // - Exclude waiting_on_subtasks (parent is waiting, show children instead)
  const visibleTasks = tasks.filter(
    (task) => task.kind === "task" && task.status !== "waiting_on_subtasks",
  );

  // Group tasks into columns, with failed/blocked staying in their relevant column
  const getTasksForColumn = (column: TaskStatus): Task[] => {
    const columnTasks = visibleTasks.filter((task) => {
      if (column === "planning") {
        // Planning column: planning tasks, or failed/blocked with no plan yet
        return (
          task.status === "planning" ||
          ((task.status === "failed" || task.status === "blocked") && !task.plan && !task.breakdown)
        );
      }
      if (column === "breaking_down") {
        // Breaking Down column: breaking_down tasks, or failed/blocked with plan but no breakdown
        return (
          task.status === "breaking_down" ||
          ((task.status === "failed" || task.status === "blocked") &&
            task.plan !== undefined &&
            !task.breakdown)
        );
      }
      if (column === "working") {
        // Working column: working tasks, or failed/blocked in working phase
        // (has breakdown but no summary yet - was working on implementation)
        return (
          task.status === "working" ||
          ((task.status === "failed" || task.status === "blocked") &&
            task.breakdown !== undefined &&
            task.summary === undefined)
        );
      }
      if (column === "reviewing") {
        // Reviewing column: reviewing tasks, or failed/blocked during review phase
        return (
          task.status === "reviewing" ||
          ((task.status === "failed" || task.status === "blocked") && task.summary !== undefined)
        );
      }
      // Done column: only done tasks
      return task.status === column;
    });

    // Sort: needs review first, then active (has agent_pid), then failed/blocked last
    return columnTasks.sort((a, b) => {
      // Needs review items at top
      const aReview = needsReview(a) ? 0 : 1;
      const bReview = needsReview(b) ? 0 : 1;
      if (aReview !== bReview) return aReview - bReview;

      // Failed/blocked items at bottom
      const aFailed = a.status === "failed" || a.status === "blocked" ? 1 : 0;
      const bFailed = b.status === "failed" || b.status === "blocked" ? 1 : 0;
      if (aFailed !== bFailed) return aFailed - bFailed;

      // Active items (with agent running) above idle items
      const aActive = a.agent_pid ? 0 : 1;
      const bActive = b.agent_pid ? 0 : 1;
      return aActive - bActive;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 pt-6 pb-6 h-full">
          {/* Left padding spacer */}
          <div className="flex-shrink-0 w-2" aria-hidden="true" />
          {COLUMNS.map((status) => {
            const columnTasks = getTasksForColumn(status);
            return (
              <div
                key={status}
                className="flex-shrink-0 w-72 bg-gray-50 rounded-lg p-4 flex flex-col h-full"
              >
                <h2 className="font-medium text-gray-700 mb-4 flex items-center gap-2 flex-shrink-0">
                  <span className={`w-3 h-3 rounded-full ${COLUMN_COLORS[status]}`} />
                  {TASK_STATUS_CONFIG[status].label}
                  <span className="text-gray-400 text-sm">({columnTasks.length})</span>
                </h2>
                <div className="space-y-3 overflow-y-auto flex-1">
                  {columnTasks.length === 0 ? (
                    <div className="text-gray-400 text-sm text-center py-8">No tasks</div>
                  ) : (
                    columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClick={() => onSelectTask(task)}
                        isSelected={task.id === selectedTaskId}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
          {/* Right padding spacer */}
          <div className="flex-shrink-0 w-2" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
