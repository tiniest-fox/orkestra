/**
 * Kanban board utilities.
 */

import type { WorkflowConfig, WorkflowTask } from "../types/workflow";
import { hasPendingQuestions, needsReview } from "../types/workflow";
import { titleCase } from "./formatters";

/**
 * Column definition for the kanban board.
 */
export interface KanbanColumn {
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
export function buildColumns(config: WorkflowConfig): KanbanColumn[] {
  const columns: KanbanColumn[] = [];

  // Add stage columns from config
  config.stages.forEach((stage, index) => {
    columns.push({
      id: stage.name,
      label: stage.display_name || titleCase(stage.name),
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
export function getTasksForColumn(tasks: WorkflowTask[], columnId: string): WorkflowTask[] {
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
