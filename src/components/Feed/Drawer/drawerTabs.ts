//! Tab management helpers and shared types for the TaskDrawer.

import type { PrCheckData, PrCommentData, WorkflowTaskView } from "../../../types/workflow";
import type { DrawerTab } from "../DrawerTabBar";

// ============================================================================
// Types
// ============================================================================

export type DrawerTabId =
  | "agent"
  | "subtasks"
  // "logs" and "artifact" remain in the union for HistoricalRunView, which manages
  // its own internal tab bar for past stage runs and is not routed through availableTabs().
  | "logs"
  | "diff"
  | "artifact"
  | "history"
  | "pr"
  | "error"
  | "run"
  | "resources";

export type PrTabFooterState =
  | { type: "loading" }
  | { type: "no_pr" }
  | { type: "conflicts" }
  | {
      type: "feedback_selected";
      commentCount: number;
      checkCount: number;
      comments: PrCommentData[];
      checks: PrCheckData[];
      guidance: string;
    }
  | { type: "clean" };

export type { DraftComment } from "../../Diff/types";

// ============================================================================
// Helpers
// ============================================================================

/** Unified predicate for whether the run script feature is available for a task. */
export function canUseRunScript(
  task: WorkflowTaskView,
  hasRunScript: boolean | undefined,
): boolean {
  return !!hasRunScript && !!task.worktree_path && !task.derived.is_archived;
}

export function defaultTab(task: WorkflowTaskView): DrawerTabId {
  if (task.derived.is_failed) return "error";
  if (task.derived.is_blocked) return "error";
  if (task.derived.is_chatting) return "agent";
  if (task.derived.has_questions) return "agent";
  if (task.derived.needs_review) return "agent";
  if (task.state.type === "gate_running" || task.state.type === "awaiting_gate") return "agent";
  if (task.derived.is_working || task.derived.is_interrupted) return "agent";
  if (task.derived.is_done) return task.pr_url ? "pr" : "diff";
  if (task.derived.is_waiting_on_children) return "subtasks";
  return "agent";
}

export function availableTabs(
  task: WorkflowTaskView,
  options?: { hasRunScript?: boolean },
): DrawerTab[] {
  const runTab: DrawerTab = { id: "run" as const, label: "Run", hotkey: "r" };
  const showRunTab = canUseRunScript(task, options?.hasRunScript);
  const hasResources = Object.keys(task.resources).length > 0;
  const resourcesTab: DrawerTab = { id: "resources" as const, label: "Resources" };

  const agentTab: DrawerTab = { id: "agent" as const, label: "Agent", hotkey: "l" };

  if (task.derived.is_failed) {
    return [
      { id: "error", label: "Error", hotkey: "e" },
      agentTab,
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_blocked) {
    return [
      { id: "error", label: "Error", hotkey: "e" },
      agentTab,
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.has_questions) {
    return [
      agentTab,
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_waiting_on_children) {
    return [
      { id: "subtasks", label: "Subtraks", hotkey: "t" },
      agentTab,
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_done) {
    if (task.pr_url) {
      return [
        { id: "pr", label: "PR", hotkey: "p" },
        { id: "diff", label: "Diff", hotkey: "d" },
        agentTab,
        { id: "history", label: "History", hotkey: "h" },
        ...(showRunTab ? [runTab] : []),
        ...(hasResources ? [resourcesTab] : []),
      ];
    }
    return [
      { id: "diff", label: "Diff", hotkey: "d" },
      agentTab,
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.needs_review) {
    return [
      agentTab,
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  return [
    agentTab,
    { id: "diff", label: "Diff", hotkey: "d" },
    { id: "history", label: "History", hotkey: "h" },
    ...(showRunTab ? [runTab] : []),
    ...(hasResources ? [resourcesTab] : []),
  ];
}
