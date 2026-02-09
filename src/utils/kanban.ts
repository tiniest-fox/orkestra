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
export function getTasksForColumn(tasks: WorkflowTaskView[], columnId: string): WorkflowTaskView[] {
  const columnTasks = tasks.filter((task) => {
    // Terminal states
    if (columnId === "done") {
      return task.derived.is_done || task.derived.is_archived;
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

    // Archived tasks are shown in done column (handled above)
    return false;
  });

  // Sort by priority tier (failed > blocked > interrupted > questions > review > working > waiting), then by created_at
  return columnTasks.sort((a, b) => {
    const getPriority = (task: WorkflowTaskView): number => {
      const d = task.derived;
      const sp = d.subtask_progress;

      // Failed (or parent with failed subtasks)
      if (d.is_failed || (sp && sp.failed > 0)) return 0;
      // Blocked (or parent with blocked subtasks)
      if (d.is_blocked || (sp && sp.blocked > 0)) return 1;
      // Interrupted (or parent with interrupted subtasks)
      if (d.is_interrupted || (sp && sp.interrupted > 0)) return 2;
      // Needs questions answered (or parent with subtask questions)
      if (d.has_questions || (sp && sp.has_questions > 0)) return 3;
      // Needs review (or parent with subtask needing review)
      if (d.needs_review || (sp && sp.needs_review > 0)) return 4;
      // Working (agent currently running)
      if (d.is_working) return 5;
      // Idle/waiting (everything else)
      return 6;
    };

    const aPriority = getPriority(a);
    const bPriority = getPriority(b);
    if (aPriority !== bPriority) return aPriority - bPriority;

    // Within the same tier, sort by created_at (oldest first)
    return a.created_at.localeCompare(b.created_at);
  });
}
