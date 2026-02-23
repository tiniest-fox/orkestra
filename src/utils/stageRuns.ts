//! Group task iterations into stage runs — contiguous sequences of same-stage iterations.

import { artifactName } from "../types/workflow";
import type { WorkflowConfig, WorkflowIteration } from "../types/workflow";

/**
 * A contiguous sequence of iterations for the same stage.
 * Multiple iterations in the same run occur due to questions, retries, or feedback loops
 * without the stage advancing. A new run begins whenever the stage changes.
 */
export interface StageRun {
  /** Stage name. */
  stage: string;
  /** Label for the Artifact tab when viewing this run historically (e.g., "Plan", "Summary"). */
  artifactLabel: string;
  /** Key to look up in task.artifacts. */
  artifactKey: string;
  /** All iterations in this run, sorted by start time. */
  iterations: WorkflowIteration[];
  /** True if this is the last run (currently in progress or most recently completed). */
  isCurrentRun: boolean;
}

/**
 * Group a task's iterations into stage runs.
 * Consecutive iterations in the same stage collapse into one run; a stage change starts a new run.
 */
export function groupIterationsIntoRuns(
  iterations: WorkflowIteration[],
  config: WorkflowConfig,
): StageRun[] {
  const sorted = [...iterations].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const runs: StageRun[] = [];

  for (const iter of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.stage === iter.stage) {
      last.iterations.push(iter);
    } else {
      const stageConfig = config.stages.find((s) => s.name === iter.stage);
      const artKey = stageConfig ? artifactName(stageConfig.artifact) : iter.stage;
      // Use title-cased artifact key as the tab label (e.g., "plan" → "Plan", "summary" → "Summary").
      const artLabel = artKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      runs.push({
        stage: iter.stage,
        artifactLabel: artLabel,
        artifactKey: artKey,
        iterations: [iter],
        isCurrentRun: false,
      });
    }
  }

  if (runs.length > 0) {
    runs[runs.length - 1].isCurrentRun = true;
  }

  return runs;
}
