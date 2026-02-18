/**
 * Kanban board utilities.
 */

import { STAGE_PALETTE } from "../components/ui/stageColors";
import type { WorkflowConfig, WorkflowTaskView } from "../types/workflow";
import { titleCase } from "./formatters";
import { compareByPriority } from "./taskOrdering";

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
export function getTasksForColumn(tasks: WorkflowTaskView[], columnId: string): WorkflowTaskView[] {
  const columnTasks = tasks.filter((task) => {
    // Terminal states
    if (columnId === "done") {
      // Include Done, Archived, and Integrating (actively merging to main)
      return task.derived.is_done || task.derived.is_archived || task.state.type === "integrating";
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

    // Tasks without a current_stage that aren't handled above
    // (shouldn't happen in normal operation)
    return false;
  });

  // Sort by priority tier (failed > blocked > interrupted > questions > review > working > waiting), then by created_at
  return columnTasks.sort(compareByPriority);
}
