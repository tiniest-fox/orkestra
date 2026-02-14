/**
 * Centralized animation key definitions.
 *
 * Keys are dot-namespaced strings stored in ContentAnimationState.phases.
 * Static keys are string constants. Dynamic keys use factory functions.
 *
 * Every PanelContainer.Column and TabbedPanel should use keys from this module
 * as its activeKey/activeTab and panelKey values.
 */

/** Main right sidebar column (Orkestra.tsx) */
export const SidebarSlot = {
  NewTask: "SidebarSlot.NewTask",
  task: (id: string) => `SidebarSlot.Task.${id}`,
} as const;

/** Subtask detail column (Orkestra.tsx) */
export const SubtaskSlot = {
  subtask: (id: string) => `SubtaskSlot.Subtask.${id}`,
} as const;

/** Task detail main tabs (TaskDetailSidebar.tsx) */
export const TaskDetailTabs = {
  details: (taskId: string) => `TaskDetailTabs.${taskId}.Details`,
  subtasks: (taskId: string) => `TaskDetailTabs.${taskId}.Subtasks`,
  iterations: (taskId: string) => `TaskDetailTabs.${taskId}.Iterations`,
  logs: (taskId: string) => `TaskDetailTabs.${taskId}.Logs`,
  artifacts: (taskId: string) => `TaskDetailTabs.${taskId}.Artifacts`,
  pr: (taskId: string) => `TaskDetailTabs.${taskId}.Pr`,
} as const;

/** Task detail footer column (TaskDetailSidebar.tsx) */
export const TaskDetailFooterSlot = {
  Delete: "TaskDetailFooterSlot.Delete",
  Questions: "TaskDetailFooterSlot.Questions",
  Review: "TaskDetailFooterSlot.Review",
} as const;

/** Artifact sub-tabs (ArtifactsTab.tsx) */
export const ArtifactTabs = {
  artifact: (name: string) => `ArtifactTabs.${name}`,
} as const;

/** Log stage sub-tabs (LogsTab.tsx) */
export const LogTabs = {
  stage: (name: string) => `LogTabs.${name}`,
} as const;

/** Main content area (Kanban board) */
export const MainContentSlot = {
  Board: "MainContentSlot.Board",
} as const;

/** Task accessory panel (diff viewer, etc.) */
export const TaskAccessorySlot = {
  diff: (taskId: string) => `TaskAccessorySlot.Diff.${taskId}`,
} as const;
