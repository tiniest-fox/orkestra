//! Tab management helpers and shared types for the TaskDrawer.

import type {
  PrCheckData,
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
  | "gate"
  | "run"
  | "resources";

export type StageReviewType = "violet" | "teal";

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
  return (
    !!hasRunScript && !!task.worktree_path && !task.derived.is_done && !task.derived.is_archived
  );
}

export function currentArtifact(
  task: WorkflowTaskView,
  config: WorkflowConfig,
): WorkflowArtifact | null {
  // For active tasks, resolve the artifact from the current stage.
  // For terminal tasks (done, failed, blocked), current_stage is null — fall back
  // to the last iteration's stage so the artifact remains visible.
  const stageName =
    task.derived.current_stage ??
    (task.iterations.length > 0 ? task.iterations[task.iterations.length - 1].stage : null);
  // Search the task's flow stages, then fall back to all flows for historical iterations.
  const stageEntry =
    config.flows[task.flow]?.stages.find((s) => s.name === stageName) ??
    Object.values(config.flows)
      .flatMap((f) => f.stages)
      .find((s) => s.name === stageName);
  if (!stageEntry) return null;
  return task.artifacts[artifactName(stageEntry.artifact)] ?? null;
}

export function stageReviewType(task: WorkflowTaskView, config: WorkflowConfig): StageReviewType {
  const stage = config.flows[task.flow]?.stages.find((s) => s.name === task.derived.current_stage);
  return stage?.capabilities.subtasks ? "teal" : "violet";
}

export function defaultTab(task: WorkflowTaskView): DrawerTabId {
  if (task.derived.is_failed) return "error";
  if (task.derived.is_blocked) return "error";
  if (task.derived.has_questions) return "questions";
  if (task.derived.needs_review) return "artifact";
  if (task.state.type === "gate_running" || task.state.type === "awaiting_gate") return "gate";
  if (task.derived.is_working || task.derived.is_interrupted) return "logs";
  if (task.derived.is_done) return task.pr_url ? "pr" : "diff";
  if (task.derived.is_waiting_on_children) return "subtasks";
  return "logs";
}

export function findGateStage(config: WorkflowConfig, flow: string) {
  return (config.flows[flow]?.stages ?? []).find((s) => s.gate) ?? null;
}

export function availableTabs(
  task: WorkflowTaskView,
  config: WorkflowConfig,
  options?: { hasRunScript?: boolean },
): DrawerTab[] {
  // Show gate tab when the current stage has a gate AND gate output is available or running.
  const gateStage = findGateStage(config, task.flow);
  const isGateState = task.state.type === "awaiting_gate" || task.state.type === "gate_running";
  const hasGateResult = task.iterations.some((i) => i.stage === gateStage?.name && i.gate_result);
  const showGateTab =
    !!gateStage &&
    (isGateState || (hasGateResult && task.derived.current_stage === gateStage.name));
  const gateTab: DrawerTab = { id: "gate" as const, label: "Gate", hotkey: "g" };
  const runTab: DrawerTab = { id: "run" as const, label: "Run", hotkey: "r" };
  const showRunTab = canUseRunScript(task, options?.hasRunScript);
  const hasResources = Object.keys(task.resources).length > 0;
  const resourcesTab: DrawerTab = { id: "resources" as const, label: "Resources" };

  if (task.derived.is_failed) {
    return [
      { id: "error", label: "Error", hotkey: "e" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_blocked) {
    return [
      { id: "error", label: "Error", hotkey: "e" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.has_questions) {
    return [
      { id: "questions", label: "Questions", hotkey: "q" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_waiting_on_children) {
    return [
      { id: "subtasks", label: "Subtraks", hotkey: "t" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.is_done) {
    if (task.pr_url) {
      return [
        { id: "pr", label: "PR", hotkey: "p" },
        { id: "diff", label: "Diff", hotkey: "d" },
        { id: "artifact", label: "Artifact", hotkey: "a" },
        { id: "logs", label: "Logs", hotkey: "l" },
        { id: "history", label: "History", hotkey: "h" },
        ...(showGateTab ? [gateTab] : []),
        ...(showRunTab ? [runTab] : []),
        ...(hasResources ? [resourcesTab] : []),
      ];
    }
    return [
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "artifact", label: "Artifact", hotkey: "a" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  if (task.derived.needs_review) {
    return [
      { id: "artifact", label: "Artifact" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
      ...(showGateTab ? [gateTab] : []),
      ...(showRunTab ? [runTab] : []),
      ...(hasResources ? [resourcesTab] : []),
    ];
  }
  return [
    { id: "logs", label: "Logs", hotkey: "l" },
    { id: "diff", label: "Diff", hotkey: "d" },
    { id: "artifact", label: "Artifact", hotkey: "a" },
    { id: "history", label: "History", hotkey: "h" },
    ...(showGateTab ? [gateTab] : []),
    ...(showRunTab ? [runTab] : []),
    ...(hasResources ? [resourcesTab] : []),
  ];
}
