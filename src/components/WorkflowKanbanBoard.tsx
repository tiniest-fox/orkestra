/**
 * Kanban board for the workflow system.
 * Columns are generated dynamically from the workflow configuration.
 */

import type { WorkflowConfig, WorkflowTask } from "../types/workflow";
import { capitalizeFirst, hasPendingQuestions, needsReview } from "../types/workflow";
import { Panel } from "./ui";
import { WorkflowTaskCard } from "./WorkflowTaskCard";

interface WorkflowKanbanBoardProps {
  config: WorkflowConfig;
  tasks: WorkflowTask[];
  selectedTaskId?: string;
  onSelectTask: (task: WorkflowTask) => void;
}

/**
 * Column definition for the kanban board.
 */
interface Column {
  /** Column identifier (stage name or "done"/"failed"/"blocked"). */
  id: string;
  /** Display label for the column header. */
  label: string;
  /** Tailwind color class for the column dot. */
  color: string;
}

/**
 * Color palette for stage columns - using sage-based palette.
 */
const STAGE_COLORS = [
  "bg-stone-500", // First stage
  "bg-sage-500",
  "bg-sage-400",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sage-600",
  "bg-sage-700",
  "bg-stone-600",
];

/**
 * Build columns from workflow config.
 * Returns stage columns plus terminal state columns.
 */
function buildColumns(config: WorkflowConfig): Column[] {
  const columns: Column[] = [];

  // Add stage columns from config
  config.stages.forEach((stage, index) => {
    columns.push({
      id: stage.name,
      label: stage.display_name || capitalizeFirst(stage.name),
      color: STAGE_COLORS[index % STAGE_COLORS.length],
    });
  });

  // Add terminal state columns - using semantic colors
  columns.push(
    { id: "done", label: "Done", color: "bg-success" },
    { id: "failed", label: "Failed", color: "bg-error" },
    { id: "blocked", label: "Blocked", color: "bg-blocked" },
  );

  return columns;
}

/**
 * Get tasks for a specific column.
 */
function getTasksForColumn(tasks: WorkflowTask[], columnId: string): WorkflowTask[] {
  const columnTasks = tasks.filter((task) => {
    // Terminal states
    if (columnId === "done") {
      return task.status.type === "done";
    }
    if (columnId === "failed") {
      return task.status.type === "failed";
    }
    if (columnId === "blocked") {
      return task.status.type === "blocked";
    }

    // Active tasks - match by stage name
    if (task.status.type === "active") {
      return task.status.stage === columnId;
    }

    // Waiting on children - parent task is hidden while children work
    // The subtasks are visible in their respective stage columns instead
    if (task.status.type === "waiting_on_children") {
      return false;
    }

    return false;
  });

  // Sort: needs review/questions first, then active (agent_working phase), then by creation date
  return columnTasks.sort((a, b) => {
    // Needs review/questions items at top
    const aReview = needsReview(a) || hasPendingQuestions(a) ? 0 : 1;
    const bReview = needsReview(b) || hasPendingQuestions(b) ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;

    // Active items (with agent running) above idle items
    const aActive = a.phase === "agent_working" ? 0 : 1;
    const bActive = b.phase === "agent_working" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    // Sort by created_at (oldest first)
    return a.created_at.localeCompare(b.created_at);
  });
}

export function WorkflowKanbanBoard({
  config,
  tasks,
  selectedTaskId,
  onSelectTask,
}: WorkflowKanbanBoardProps) {
  const columns = buildColumns(config);

  // Filter out subtasks (parent_id set) for main board view
  const visibleTasks = tasks.filter((task) => !task.parent_id);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 pt-6 pb-6 h-full">
          {/* Left padding spacer */}
          <div className="flex-shrink-0 w-2" aria-hidden="true" />

          {columns.map((column) => {
            const columnTasks = getTasksForColumn(visibleTasks, column.id);
            return (
              <Panel key={column.id} className="flex-shrink-0 w-72 p-4 h-full bg-stone-50">
                <h2 className="font-heading font-medium text-stone-700 mb-4 flex items-center gap-2 flex-shrink-0">
                  <span className={`w-3 h-3 rounded-full ${column.color}`} />
                  {column.label}
                  <span className="text-stone-400 text-sm">({columnTasks.length})</span>
                </h2>
                <div className="space-y-3 overflow-y-auto flex-1">
                  {columnTasks.length === 0 ? (
                    <div className="text-stone-400 text-sm text-center py-8">No tasks</div>
                  ) : (
                    columnTasks.map((task) => (
                      <WorkflowTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => onSelectTask(task)}
                        isSelected={task.id === selectedTaskId}
                      />
                    ))
                  )}
                </div>
              </Panel>
            );
          })}

          {/* Right padding spacer */}
          <div className="flex-shrink-0 w-2" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
