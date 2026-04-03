// Flow-aware stage lookup helpers for workflow config.

import type { StageConfig, WorkflowConfig } from "../types/workflow";

/** Return all stages for a named flow. Returns [] if the flow does not exist. */
export function resolveStages(config: WorkflowConfig, flow: string): StageConfig[] {
  return config.flows[flow]?.stages ?? [];
}
