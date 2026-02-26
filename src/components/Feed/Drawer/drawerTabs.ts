//! Tab management helpers and shared types for the TaskDrawer.

import type {
  PrCommentData,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowTaskView,
} from "../../../types/workflow";
import { artifactName } from "../../../types/workflow";
import type { DrawerTab } from "../DrawerTabBar";

// ============================================================================
// Types
// ============================================================================

export type DrawerTabId =
  | "questions"
  | "subtasks"
  | "logs"
  | "diff"
  | "artifact"
  | "history"
  | "pr"
  | "error"
  | "gate";

export type StageReviewType = "violet" | "teal";

export type PrTabFooterState =
  | { type: "loading" }
  | { type: "no_pr" }
  | { type: "conflicts" }
  | { type: "comments_selected"; count: number; comments: PrCommentData[]; guidance: string }
  | { type: "clean" };

// ============================================================================
// Helpers
// ============================================================================

export function currentArtifact(
  task: WorkflowTaskView,
  config: WorkflowConfig,
): WorkflowArtifact | null {
  const stageEntry = config.stages.find((s) => s.name === task.derived.current_stage);
  if (!stageEntry) return null;
  return task.artifacts[artifactName(stageEntry.artifact)] ?? null;
}

export function stageReviewType(task: WorkflowTaskView, config: WorkflowConfig): StageReviewType {
  const stage = config.stages.find((s) => s.name === task.derived.current_stage);
  return stage?.capabilities.subtasks ? "teal" : "violet";
}

export function defaultTab(task: WorkflowTaskView): DrawerTabId {
  if (task.derived.is_failed) return "error";
  if (task.derived.has_questions) return "questions";
  if (task.derived.needs_review) return "artifact";
  if (task.state.type === "gate_running" || task.state.type === "awaiting_gate") return "gate";
  if (task.derived.is_working || task.derived.is_interrupted) return "logs";
  if (task.derived.is_done) return task.pr_url ? "pr" : "diff";
  if (task.derived.is_waiting_on_children) return "subtasks";
  return "logs";
}

export function findGateStage(config: WorkflowConfig) {
  return config.stages.find((s) => s.gate) ?? null;
}

export function availableTabs(task: WorkflowTaskView, config: WorkflowConfig): DrawerTab[] {
  // Show gate tab when the current stage has a gate AND gate output is available or running.
  const gateStage = findGateStage(config);
  const isGateState =
    task.state.type === "awaiting_gate" || task.state.type === "gate_running";
  const hasGateResult = task.iterations.some(
    (i) => i.stage === gateStage?.name && i.gate_result,
  );
  const showGateTab = !!gateStage && (isGateState || hasGateResult);
  const gateTab: DrawerTab = { id: "gate" as const, label: "Gate", hotkey: "g" };

  if (task.derived.is_failed) {
    return [
      { id: "error", label: "Error", hotkey: "e" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
    ];
  }
  if (task.derived.has_questions) {
    return [
      { id: "questions", label: "Questions", hotkey: "q" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
    ];
  }
  if (task.derived.is_waiting_on_children) {
    return [
      { id: "subtasks", label: "Subtasks", hotkey: "t" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
    ];
  }
  if (task.derived.is_done) {
    if (task.pr_url) {
      return [
        { id: "pr", label: "PR", hotkey: "p" },
        { id: "diff", label: "Diff", hotkey: "d" },
        { id: "artifact", label: "Artifact", hotkey: "a" },
        { id: "history", label: "History", hotkey: "h" },
        ...(showGateTab ? [gateTab] : []),
      ];
    }
    return [
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "artifact", label: "Artifact", hotkey: "a" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
    ];
  }
  if (task.derived.needs_review) {
    return [
      { id: "artifact", label: "Artifact", hotkey: "a" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
    ];
  }
  return [
    { id: "logs", label: "Logs", hotkey: "l" },
    { id: "diff", label: "Diff", hotkey: "d" },
    { id: "artifact", label: "Artifact", hotkey: "a" },
    { id: "history", label: "History", hotkey: "h" },
    ...(showGateTab ? [gateTab] : []),
  ];
}
