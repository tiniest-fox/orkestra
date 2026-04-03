// Flow-aware stage navigation helpers for workflow config.

import type { WorkflowConfig } from "../types/workflow";

/** Return ordered stage names for a task's flow. */
export function resolveFlowStageNames(taskFlow: string, config: WorkflowConfig): string[] {
  return (config.flows[taskFlow]?.stages ?? []).map((s) => s.name);
}

/** Return the next stage name after currentStage, or null if last. */
export function nextStageInFlow(
  currentStage: string,
  taskFlow: string,
  config: WorkflowConfig,
): string | null {
  const stages = resolveFlowStageNames(taskFlow, config);
  const index = stages.indexOf(currentStage);
  if (index === -1 || index === stages.length - 1) return null;
  return stages[index + 1];
}
