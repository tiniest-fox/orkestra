/**
 * Compact iteration activity indicator for task cards.
 * Shows a strip of colored squares representing recent iteration outcomes.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { resolveIcon } from "../../utils/iconMap";
import {
  getOutcomeIndicatorColor,
  getOutcomeSemantic,
  outcomeLabel,
} from "../../utils/iterationOutcomes";

interface IterationIndicatorProps {
  iterations: WorkflowIteration[];
  /** Map of stage name to icon name (from workflow config). */
  stageIcons: Record<string, string>;
  /** Maximum number of iterations to display (default: 9) */
  maxVisible?: number;
}

/**
 * Get first letter of stage name for display.
 */
function getStageInitial(stage: string): string {
  return stage.charAt(0).toUpperCase();
}

/**
 * Capitalize stage name for display (e.g., "work" -> "Work").
 */
function capitalizeStage(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

/**
 * Get tooltip alignment classes based on position in the iteration list.
 * Returns classes for the tooltip body and arrow to prevent clipping at edges.
 */
function getTooltipAlignment(
  index: number,
  total: number,
  hasHiddenCounter: boolean,
): { tooltipClasses: string; arrowClasses: string } {
  // For very small lists (≤3), only apply edge positioning to actual first/last
  if (total <= 3) {
    if (index === 0) {
      return {
        tooltipClasses: "left-0",
        arrowClasses: "left-2",
      };
    }
    if (index === total - 1) {
      return {
        tooltipClasses: "right-0",
        arrowClasses: "right-2",
      };
    }
    return {
      tooltipClasses: "left-1/2 -translate-x-1/2",
      arrowClasses: "left-1/2 -translate-x-1/2",
    };
  }

  // For larger lists, apply edge positioning to first/last 2 indicators
  // If there's a +N counter, it provides buffer on the left, so only first 1 needs left-align
  const leftEdgeCount = hasHiddenCounter ? 1 : 2;

  if (index < leftEdgeCount) {
    return {
      tooltipClasses: "left-0",
      arrowClasses: "left-2",
    };
  }

  if (index >= total - 2) {
    return {
      tooltipClasses: "right-0",
      arrowClasses: "right-2",
    };
  }

  // Center alignment for middle indicators
  return {
    tooltipClasses: "left-1/2 -translate-x-1/2",
    arrowClasses: "left-1/2 -translate-x-1/2",
  };
}

export function IterationIndicator({
  iterations,
  stageIcons,
  maxVisible = 9,
}: IterationIndicatorProps) {
  if (iterations.length === 0) {
    return null;
  }

  // Sort by started_at to ensure chronological order (earliest first)
  const sortedIterations = [...iterations].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );

  // Special case: if we have exactly 10, show all 10 (no +X counter needed)
  const effectiveMaxVisible = sortedIterations.length === 10 ? 10 : maxVisible;

  // Show most recent iterations (slice from end), with hidden count on left
  const hiddenCount = Math.max(0, sortedIterations.length - effectiveMaxVisible);
  const visibleIterations = sortedIterations.slice(-effectiveMaxVisible);

  return (
    <div className="flex items-center gap-1 mt-2">
      {hiddenCount > 0 && (
        <span className="text-xs text-stone-400 dark:text-stone-500 font-mono mr-0.5">
          +{hiddenCount}
        </span>
      )}
      {visibleIterations.map((iteration, index) => {
        const semantic = getOutcomeSemantic(iteration.outcome);
        const colorClass = getOutcomeIndicatorColor(semantic);
        const initial = getStageInitial(iteration.stage);
        const tooltipText = `${capitalizeStage(iteration.stage)} — ${outcomeLabel(iteration.outcome)}`;

        // Resolve icon for this stage
        const iconName = stageIcons[iteration.stage];
        const Icon = resolveIcon(iconName);

        // Get tooltip positioning based on index to prevent clipping at edges
        const { tooltipClasses, arrowClasses } = getTooltipAlignment(
          index,
          visibleIterations.length,
          hiddenCount > 0,
        );

        return (
          <div key={iteration.id} className="relative group">
            <div
              className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-semibold ${colorClass} cursor-default`}
            >
              {Icon ? <Icon size={10} className="flex-shrink-0" /> : initial}
            </div>
            {/* Tooltip */}
            <div
              className={`absolute bottom-full ${tooltipClasses} mb-2 px-2 py-1 bg-stone-900 dark:bg-stone-700 text-white text-xs rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10`}
            >
              {tooltipText}
              {/* Arrow */}
              <div
                className={`absolute top-full ${arrowClasses} w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-stone-900 dark:border-t-stone-700`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
