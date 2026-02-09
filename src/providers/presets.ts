/**
 * Preset-based layout system for Orkestra UI.
 *
 * Every user action maps to a named preset that specifies which component
 * fills each layout slot (content, panel, secondaryPanel).
 */

// =============================================================================
// Types
// =============================================================================

/** Named layout presets representing all possible UI states. */
export type PresetName =
  | "Board"
  | "Task"
  | "Subtask"
  | "NewTask"
  | "TaskDiff"
  | "SubtaskDiff"
  | "GitHistory"
  | "GitCommit"
  | "Assistant"
  | "AssistantHistory";

/** Component types that can occupy layout slots. */
export type SlotContent =
  | "KanbanBoard"
  | "TaskDetail"
  | "SubtaskDetail"
  | "NewTaskPanel"
  | "DiffPanel"
  | "CommitDiffPanel"
  | "GitHistoryPanel"
  | "AssistantPanel"
  | "SessionHistory"
  | null;

/** Layout configuration for a preset. */
export interface LayoutPreset {
  content: SlotContent;
  panel: SlotContent;
  secondaryPanel: SlotContent;
}

/** Runtime layout state. */
export interface LayoutState {
  preset: PresetName;
  isArchive: boolean;
  taskId: string | null;
  subtaskId: string | null;
  commitHash: string | null;
}

// =============================================================================
// Static Preset Lookup Table
// =============================================================================

export const PRESETS: Record<PresetName, LayoutPreset> = {
  Board: { content: "KanbanBoard", panel: null, secondaryPanel: null },
  Task: { content: "KanbanBoard", panel: "TaskDetail", secondaryPanel: null },
  Subtask: {
    content: "KanbanBoard",
    panel: "TaskDetail",
    secondaryPanel: "SubtaskDetail",
  },
  NewTask: { content: "KanbanBoard", panel: "NewTaskPanel", secondaryPanel: null },
  TaskDiff: { content: "DiffPanel", panel: "TaskDetail", secondaryPanel: null },
  SubtaskDiff: { content: "DiffPanel", panel: "SubtaskDetail", secondaryPanel: null },
  GitHistory: { content: "KanbanBoard", panel: "GitHistoryPanel", secondaryPanel: null },
  GitCommit: { content: "CommitDiffPanel", panel: "GitHistoryPanel", secondaryPanel: null },
  Assistant: { content: "KanbanBoard", panel: "AssistantPanel", secondaryPanel: null },
  AssistantHistory: {
    content: "KanbanBoard",
    panel: "AssistantPanel",
    secondaryPanel: "SessionHistory",
  },
} as const satisfies Record<PresetName, LayoutPreset>;
