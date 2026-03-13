// Flow-aware stage navigation helpers for workflow config.

import type { WorkflowConfig } from "../types/workflow";

/** Return ordered stage names for a task's flow (or default pipeline). */
export function resolveFlowStageNames(
  taskFlow: string | undefined,
  config: WorkflowConfig,
): string[] {
  if (taskFlow && config.flows?.[taskFlow]) {
    return config.flows[taskFlow].stages.map((entry) =>
      typeof entry === "string" ? entry : Object.keys(entry)[0],
    );
  }
  return config.stages.map((s) => s.name);
}

/** Return the next stage name after currentStage, or null if last. */
export function nextStageInFlow(
  currentStage: string,
  taskFlow: string | undefined,
  config: WorkflowConfig,
): string | null {
  const stages = resolveFlowStageNames(taskFlow, config);
  const index = stages.indexOf(currentStage);
  if (index === -1 || index === stages.length - 1) return null;
  return stages[index + 1];
}
