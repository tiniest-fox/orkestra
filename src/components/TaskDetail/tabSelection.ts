/**
 * Shared tab logic for task detail views.
 *
 * Extracted from TaskDetailSidebar and ArchiveTaskDetailView to avoid duplication.
 */

import type { WorkflowTaskView } from "../../types/workflow";
import { TaskDetailTabs } from "../ui";

export interface Tab {
  id: string;
  label: string;
}

export function buildTabs(task: WorkflowTaskView): Tab[] {
  const tabs: Tab[] = [{ id: TaskDetailTabs.details(task.id), label: "Details" }];

  if (task.derived.subtask_progress) {
    tabs.push({
      id: TaskDetailTabs.subtasks(task.id),
      label: "Subtasks",
    });
  }

  tabs.push(
    { id: TaskDetailTabs.iterations(task.id), label: "Activity" },
    { id: TaskDetailTabs.logs(task.id), label: "Logs" },
  );

  const hasArtifacts = Object.keys(task.artifacts).length > 0;
  if (hasArtifacts) {
    tabs.push({ id: TaskDetailTabs.artifacts(task.id), label: "Artifacts" });
  }

  return tabs;
}

/**
 * Select the most relevant tab based on current task state.
 * Falls back to "details" if the preferred tab isn't available.
 */
export function smartDefaultTab(task: WorkflowTaskView, tabs: Tab[]): string {
  const tabIds = new Set(tabs.map((t) => t.id));
  const { derived } = task;

  let preferred: string;
  if (derived.is_done || task.status.type === "archived") {
    preferred = TaskDetailTabs.artifacts(task.id);
  } else if (derived.is_failed || derived.is_blocked) {
    preferred = TaskDetailTabs.details(task.id);
  } else if (derived.is_interrupted) {
    preferred = TaskDetailTabs.details(task.id);
  } else if (task.status.type === "waiting_on_children") {
    preferred = TaskDetailTabs.subtasks(task.id);
  } else if (derived.is_working || derived.is_system_active) {
    preferred = TaskDetailTabs.logs(task.id);
  } else if (derived.needs_review) {
    preferred = TaskDetailTabs.artifacts(task.id);
  } else {
    preferred = TaskDetailTabs.details(task.id);
  }

  return tabIds.has(preferred) ? preferred : TaskDetailTabs.details(task.id);
}
