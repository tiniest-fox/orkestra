/**
 * Kanban board utilities.
 */

import { STAGE_PALETTE } from "../components/ui/stageColors";
import type { WorkflowConfig, WorkflowTaskView } from "../types/workflow";
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
      color: STAGE_PALETTE[index % STAGE_PALETTE.length].dot,
    });
  });

  // Add terminal state columns - using semantic colors
  columns.push(
    { id: "done", label: "Done", color: "bg-success-500" },
    { id: "failed", label: "Failed", color: "bg-error-500" },
    { id: "blocked", label: "Blocked", color: "bg-warning-500" },
  );

  return columns;
}

/**
 * Get tasks for a specific column.
 */
export function getTasksForColumn(
  tasks: WorkflowTaskView[],
  columnId: string,
): WorkflowTaskView[] {
  const columnTasks = tasks.filter((task) => {
    // Terminal states
    if (columnId === "done") {
      return task.derived.is_done;
    }
    if (columnId === "failed") {
      return task.derived.is_failed;
    }
    if (columnId === "blocked") {
      return task.derived.is_blocked;
    }

    // Active tasks and waiting-on-children — match by stage name
    if (task.derived.current_stage) {
      return task.derived.current_stage === columnId;
    }

    // Archived, etc. — not shown in stage columns
    return false;
  });

  // Sort: needs review/questions first, then active (agent_working phase), then by creation date
  return columnTasks.sort((a, b) => {
    // Needs review/questions items at top
    const aReview = a.derived.needs_review || a.derived.has_questions ? 0 : 1;
    const bReview = b.derived.needs_review || b.derived.has_questions ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;

    // Active items (with agent running) above idle items
    const aActive = a.derived.is_working ? 0 : 1;
    const bActive = b.derived.is_working ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    // Sort by created_at (oldest first)
    return a.created_at.localeCompare(b.created_at);
  });
}
