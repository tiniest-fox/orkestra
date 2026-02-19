//! Pure function that computes pipeline segment states for a task.

import type { WorkflowConfig, WorkflowTaskView } from "../types/workflow";

export type SegmentState =
  | "done"
  | "active"
  | "review"
  | "failed"
  | "pending"
  | "dim"
  | "integration";

export interface PipelineSegmentData {
  stageName: string;
  state: SegmentState;
}

/**
 * Compute the visual state of each pipeline segment for a task.
 *
 * Respects flow overrides when the task has a flow assigned.
 * Appends a virtual "integration" segment when the task is integrating.
 */
export function computePipelineSegments(
  task: WorkflowTaskView,
  config: WorkflowConfig,
): PipelineSegmentData[] {
  const stages = resolveStageNames(task, config);
  const { derived } = task;

  if (derived.is_done || derived.is_archived) {
    return stages.map((stageName) => ({ stageName, state: "done" }));
  }

  if (task.state.type === "integrating") {
    const segments = stages.map((stageName) => ({
      stageName,
      state: "done" as SegmentState,
    }));
    segments.push({ stageName: "integration", state: "integration" });
    return segments;
  }

  const currentStage = derived.current_stage ?? "";
  const currentIndex = stages.indexOf(currentStage);

  return stages.map((stageName, i) => {
    if (i < currentIndex) return { stageName, state: "done" };
    if (i === currentIndex) {
      if (derived.is_failed) return { stageName, state: "failed" };
      if (derived.needs_review || derived.has_questions) return { stageName, state: "review" };
      if (derived.is_working) return { stageName, state: "active" };
      return { stageName, state: "review" };
    }
    // After current
    if (derived.is_failed) return { stageName, state: "dim" };
    return { stageName, state: "pending" };
  });
}

// -- Helpers --

function resolveStageNames(task: WorkflowTaskView, config: WorkflowConfig): string[] {
  if (task.flow && config.flows?.[task.flow]) {
    return config.flows[task.flow].stages.map((entry) =>
      typeof entry === "string" ? entry : Object.keys(entry)[0],
    );
  }
  return config.stages.map((s) => s.name);
}
