/**
 * Compact iteration activity indicator for task cards.
 * Shows a strip of colored squares representing recent iteration outcomes.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { getOutcomeIndicatorColor, getOutcomeSemantic } from "../../utils/iterationOutcomes";

interface IterationIndicatorProps {
  iterations: WorkflowIteration[];
  /** Maximum number of iterations to display (default: 5) */
  maxVisible?: number;
}

/**
 * Get first letter of stage name for display.
 */
function getStageInitial(stage: string): string {
  return stage.charAt(0).toUpperCase();
}

export function IterationIndicator({ iterations, maxVisible = 5 }: IterationIndicatorProps) {
  if (iterations.length === 0) {
    return null;
  }

  // Sort by started_at to ensure chronological order (earliest first)
  const sortedIterations = [...iterations].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );

  // Show most recent iterations (slice from end), with hidden count on left
  const hiddenCount = Math.max(0, sortedIterations.length - maxVisible);
  const visibleIterations = sortedIterations.slice(-maxVisible);

  return (
    <div className="flex items-center gap-1 mt-2">
      {hiddenCount > 0 && (
        <span className="text-xs text-stone-400 dark:text-stone-500 font-mono mr-0.5">
          +{hiddenCount}
        </span>
      )}
      {visibleIterations.map((iteration) => {
        const semantic = getOutcomeSemantic(iteration.outcome);
        const colorClass = getOutcomeIndicatorColor(semantic);
        const initial = getStageInitial(iteration.stage);

        return (
          <div
            key={iteration.id}
            className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-semibold ${colorClass}`}
            title={`${iteration.stage} #${iteration.iteration_number}${iteration.outcome ? ` - ${iteration.outcome.type}` : " - in progress"}`}
          >
            {initial}
          </div>
        );
      })}
    </div>
  );
}
