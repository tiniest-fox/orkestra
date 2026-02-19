//! Pure function that classifies tasks into three intent-based feed sections.

import type { WorkflowTaskView } from "../types/workflow";
import { compareByPriority } from "./taskOrdering";

export type FeedSectionName = "needs_review" | "in_progress" | "completed";

export interface FeedSection {
  name: FeedSectionName;
  label: string;
  tasks: WorkflowTaskView[];
}

export interface FeedGroupResult {
  sections: FeedSection[];
  /** Subtasks surfaced into Needs Review */
  surfacedSubtasks: WorkflowTaskView[];
}

/**
 * Group top-level tasks into three intent-based sections and surface
 * subtasks that need attention into the Needs Review section.
 *
 * Classification order (first match wins):
 * - needs_review: derived.needs_review || derived.has_questions
 * - completed: derived.is_done || derived.is_archived
 * - in_progress: everything else
 */
export function groupTasksForFeed(tasks: WorkflowTaskView[]): FeedGroupResult {
  const topLevel = tasks.filter((t) => !t.parent_id);
  const subtasks = tasks.filter(
    (t) =>
      t.parent_id !== undefined &&
      (t.derived.needs_review || t.derived.has_questions || t.derived.is_failed),
  );

  const needsReview: WorkflowTaskView[] = [];
  const inProgress: WorkflowTaskView[] = [];
  const completed: WorkflowTaskView[] = [];

  for (const task of topLevel) {
    if (task.derived.needs_review || task.derived.has_questions) {
      needsReview.push(task);
    } else if (task.derived.is_done || task.derived.is_archived) {
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
        tasks: needsReview.sort(compareByPriority),
      },
      {
        name: "in_progress",
        label: "IN PROGRESS",
        tasks: inProgress.sort(compareByPriority),
      },
      {
        name: "completed",
        label: "COMPLETED",
        tasks: completed.sort(compareByPriority),
      },
    ],
    surfacedSubtasks: subtasks.sort(compareByPriority),
  };
}
