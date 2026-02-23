//! Pure function that classifies tasks into four intent-based feed sections.

import type { WorkflowTaskView } from "../types/workflow";

// Sort oldest updated_at first — approximates "time entered this section."
function byUpdatedAt(a: WorkflowTaskView, b: WorkflowTaskView): number {
  return a.updated_at.localeCompare(b.updated_at);
}

export type FeedSectionName = "needs_review" | "ready_to_ship" | "in_progress" | "completed";

export interface FeedSection {
  name: FeedSectionName;
  label: string;
  tasks: WorkflowTaskView[];
}

export interface FeedGroupResult {
  sections: FeedSection[];
  /** Subtasks surfaced into Needs Review */
  surfacedSubtasks: WorkflowTaskView[];
  /** Subtasks surfaced into In Progress */
  workingSubtasks: WorkflowTaskView[];
}

/**
 * Group top-level tasks into four intent-based sections and surface
 * subtasks that need attention into the Needs Review section.
 *
 * Classification order (first match wins):
 * - needs_review: derived.needs_review || derived.has_questions || subtask needs review
 * - ready_to_ship: derived.is_done (false once archived, so no extra guard needed)
 * - completed: derived.is_archived
 * - in_progress: everything else
 */
export function groupTasksForFeed(tasks: WorkflowTaskView[]): FeedGroupResult {
  const topLevel = tasks.filter((t) => !t.parent_id);
  const allSubtasks = tasks.filter((t) => t.parent_id !== undefined);

  const subtaskNeedsAttention = new Set(
    allSubtasks
      .filter(
        (t) =>
          t.derived.needs_review ||
          t.derived.has_questions ||
          t.derived.is_failed ||
          t.derived.is_interrupted ||
          t.derived.is_blocked,
      )
      .map((t) => t.parent_id as string),
  );

  const subtasks = allSubtasks.filter(
    (t) =>
      t.derived.needs_review ||
      t.derived.has_questions ||
      t.derived.is_failed ||
      t.derived.is_interrupted ||
      t.derived.is_blocked,
  );
  const working = allSubtasks.filter((t) => t.derived.is_working);

  const needsReview: WorkflowTaskView[] = [];
  const readyToShip: WorkflowTaskView[] = [];
  const inProgress: WorkflowTaskView[] = [];
  const completed: WorkflowTaskView[] = [];

  for (const task of topLevel) {
    const subtaskNeedsReview = subtaskNeedsAttention.has(task.id);
    if (
      task.derived.needs_review ||
      task.derived.has_questions ||
      task.derived.is_blocked ||
      subtaskNeedsReview
    ) {
      needsReview.push(task);
    } else if (task.derived.is_done || task.state.type === "integrating") {
      readyToShip.push(task);
    } else if (task.derived.is_archived) {
      completed.push(task);
    } else {
      inProgress.push(task);
    }
  }

  return {
    sections: [
      {
        name: "needs_review",
        label: "NEEDS REVIEW",
        tasks: needsReview.sort(byUpdatedAt),
      },
      {
        name: "ready_to_ship",
        label: "READY TO SHIP",
        tasks: readyToShip.sort(byUpdatedAt),
      },
      {
        name: "in_progress",
        label: "IN PROGRESS",
        tasks: inProgress.sort(byUpdatedAt),
      },
      {
        name: "completed",
        label: "COMPLETED",
        tasks: completed.sort(byUpdatedAt),
      },
    ],
    surfacedSubtasks: subtasks.sort(byUpdatedAt),
    workingSubtasks: working.sort(byUpdatedAt),
  };
}
