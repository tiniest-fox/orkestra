// Find the iteration outcome matching an artifact's stage and iteration number.

import type { WorkflowArtifact, WorkflowOutcome, WorkflowTaskView } from "../../../types/workflow";

export function findArtifactOutcome(
  task: WorkflowTaskView,
  artifact: WorkflowArtifact,
): WorkflowOutcome | undefined {
  // Both artifact.iteration and iteration_number are 1-based.
  const match = [...task.iterations]
    .reverse()
    .find((i) => i.stage === artifact.stage && i.iteration_number === artifact.iteration);
  return match?.outcome;
}
