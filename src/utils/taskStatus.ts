//! Centralized predicates for task status classification.

import type { WorkflowTaskView } from "../types/workflow";

/**
 * Returns true when a task is actively progressing — agent running, system
 * processing, or waiting on subtasks to complete.
 *
 * Excludes: terminal states, needs-review states, and integrating (shown
 * separately in the header metrics).
 */
export function isActivelyProgressing(task: WorkflowTaskView): boolean {
  const { derived, state } = task;
  return (
    derived.is_working ||
    derived.is_preparing ||
    (derived.is_system_active && state.type !== "integrating") ||
    derived.is_waiting_on_children
  );
}
