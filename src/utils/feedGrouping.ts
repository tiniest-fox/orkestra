// Pure function that classifies tasks into six intent-based feed sections.

import type { WorkflowTaskView } from "../types/workflow";

// Sort oldest updated_at first — approximates "time entered this section."
function byUpdatedAt(a: WorkflowTaskView, b: WorkflowTaskView): number {
  return a.updated_at.localeCompare(b.updated_at);
}

export type FeedSectionName =
  | "needs_review"
  | "ready_to_ship"
  | "in_progress"
  | "open_pr"
  | "merged_pr"
  | "closed_pr"
  | "completed";

export interface FeedSection {
  name: FeedSectionName;
  label: string;
  tasks: WorkflowTaskView[];
}

export interface FeedGroupResult {
  sections: FeedSection[];
  /** Notable subtasks (working or needing attention) surfaced under their parent row. */
  subtaskRows: WorkflowTaskView[];
}

/**
 * Group top-level tasks into six intent-based sections and surface
 * subtasks that need attention into the Needs Review section.
 *
 * Classification order (first match wins):
 * - needs_review: derived.needs_review || derived.has_questions || is_blocked || is_interrupted || subtask needs review || is_chatting || chat_agent_active
 * - integrating: state.type === "integrating" → ready_to_ship
 * - merged_pr: derived.is_done AND prStates entry is "merged"
 * - closed_pr: derived.is_done AND prStates entry is "closed"
 * - open_pr: derived.is_done AND task.pr_url exists (status not yet fetched or "open")
 * - ready_to_ship: derived.is_done AND no pr_url
 * - completed: derived.is_archived
 * - in_progress: everything else
 */
export function groupTasksForFeed(
  tasks: WorkflowTaskView[],
  prStates?: Map<string, string>,
): FeedGroupResult {
  const topLevel = tasks.filter((t) => !t.parent_id);
  const allSubtasks = tasks.filter((t) => t.parent_id !== undefined);

  const needsAttention = (t: WorkflowTaskView) =>
    t.derived.needs_review ||
    t.derived.has_questions ||
    t.derived.is_failed ||
    t.derived.is_interrupted ||
    t.derived.is_blocked;

  const subtaskNeedsAttention = new Set(
    allSubtasks.filter(needsAttention).map((t) => t.parent_id as string),
  );

  const doneIds = new Set(
    tasks.filter((t) => t.derived.is_done || t.derived.is_archived).map((t) => t.id),
  );

  const notableSubtasks = allSubtasks.filter((t) => {
    if (t.derived.is_done || t.derived.is_archived || t.derived.is_waiting_on_children)
      return false;
    // Subtasks with unfinished dependencies are still waiting — don't surface them.
    if (t.depends_on?.some((dep) => !doneIds.has(dep))) return false;
    return true;
  });

  const needsReview: WorkflowTaskView[] = [];
  const readyToShip: WorkflowTaskView[] = [];
  const openPr: WorkflowTaskView[] = [];
  const mergedPr: WorkflowTaskView[] = [];
  const closedPr: WorkflowTaskView[] = [];
  const inProgress: WorkflowTaskView[] = [];
  const completed: WorkflowTaskView[] = [];

  for (const task of topLevel) {
    if (
      task.derived.needs_review ||
      task.derived.has_questions ||
      task.derived.is_blocked ||
      task.derived.is_interrupted ||
      subtaskNeedsAttention.has(task.id) ||
      task.derived.is_chatting ||
      task.derived.chat_agent_active
    ) {
      needsReview.push(task);
    } else if (task.state.type === "integrating") {
      readyToShip.push(task);
    } else if (task.derived.is_done) {
      const prState = prStates?.get(task.id);
      if (prState === "merged") {
        mergedPr.push(task);
      } else if (prState === "closed") {
        closedPr.push(task);
      } else if (task.pr_url) {
        openPr.push(task);
      } else {
        readyToShip.push(task);
      }
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
        name: "in_progress",
        label: "IN PROGRESS",
        tasks: inProgress.sort(byUpdatedAt),
      },
      {
        name: "ready_to_ship",
        label: "READY TO SHIP",
        tasks: readyToShip.sort(byUpdatedAt),
      },
      {
        name: "open_pr",
        label: "OPEN PR",
        tasks: openPr.sort(byUpdatedAt),
      },
      {
        name: "merged_pr",
        label: "MERGED PR",
        tasks: mergedPr.sort(byUpdatedAt),
      },
      {
        name: "closed_pr",
        label: "CLOSED PR",
        tasks: closedPr.sort(byUpdatedAt),
      },
      {
        name: "completed",
        label: "COMPLETED",
        tasks: completed.sort(byUpdatedAt),
      },
    ],
    subtaskRows: notableSubtasks.sort(byUpdatedAt),
  };
}
