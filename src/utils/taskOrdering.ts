/**
 * Centralized task ordering logic.
 *
 * Provides a priority-based comparator for sorting tasks in kanban columns
 * and subtask lists. Tasks are grouped into priority tiers based on their
 * state, with `created_at` as tiebreaker within tiers.
 */

import type { WorkflowTaskView } from "../types/workflow";

/**
 * Priority tiers for task ordering (lower number = higher priority).
 *
 * Tiers 0-7 apply to active tasks:
 * - 0: Failed (or parent with failed subtasks)
 * - 1: Blocked (or parent with blocked subtasks)
 * - 2: Interrupted (or parent with interrupted subtasks)
 * - 3: Has questions (or parent with subtask questions)
 * - 4: Needs review (or parent with subtask needing review)
 * - 5: Working (agent currently running)
 * - 6: System active (committing, committed, integrating, finishing)
 * - 7: Idle/waiting (everything else active)
 *
 * Tiers 8-9 apply to terminal tasks (used in subtask lists, filtered out in kanban):
 * - 8: Done
 * - 9: Archived
 */
function getPriority(task: WorkflowTaskView): number {
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
  // System active (committing, committed, integrating, finishing — no agent, but system busy)
  if (d.is_system_active) return 6;
  // Done (terminal state)
  if (d.is_done) return 8;
  // Archived (terminal state)
  if (d.is_archived) return 9;
  // Idle/waiting (everything else)
  return 7;
}

/**
 * Compare two tasks by priority tier, then by created_at (oldest first).
 *
 * Use with `Array.prototype.sort()`:
 * ```ts
 * tasks.sort(compareByPriority)
 * ```
 */
export function compareByPriority(a: WorkflowTaskView, b: WorkflowTaskView): number {
  const aPriority = getPriority(a);
  const bPriority = getPriority(b);
  if (aPriority !== bPriority) return aPriority - bPriority;

  // Within the same tier, sort by created_at (oldest first)
  return a.created_at.localeCompare(b.created_at);
}

/**
 * Sort tasks by priority tier, returning a new sorted array.
 *
 * Non-mutating convenience wrapper for `compareByPriority`.
 * ```ts
 * const sorted = sortByPriority(tasks);
 * ```
 */
export function sortByPriority(tasks: WorkflowTaskView[]): WorkflowTaskView[] {
  return [...tasks].sort(compareByPriority);
}
