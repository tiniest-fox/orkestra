/**
 * Iteration card - displays a single workflow iteration.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { formatTimestamp, titleCase } from "../../utils/formatters";
import { getOutcomeBadgeColor, getOutcomeSemantic } from "../../utils/iterationOutcomes";

interface IterationCardProps {
  iteration: WorkflowIteration;
}

function formatOutcome(outcome: WorkflowIteration["outcome"]): {
  label: string;
  color: string;
} | null {
  if (!outcome) return null;

  const semantic = getOutcomeSemantic(outcome);
  const color = getOutcomeBadgeColor(semantic);

  switch (outcome.type) {
    case "approved":
      return { label: "Approved", color };
    case "rejected":
      return { label: "Rejected", color };
    case "awaiting_answers":
      return { label: "Awaiting Answers", color };
    case "completed":
      return { label: "Completed", color };
    case "integration_failed":
      return { label: "Integration Failed", color };
    case "agent_error":
      return { label: "Agent Error", color };
    case "blocked":
      return { label: "Blocked", color };
    case "skipped":
      return { label: "Skipped", color };
    case "rejection":
      return { label: `Rejected → ${outcome.target}`, color };
  }
}

export function IterationCard({ iteration }: IterationCardProps) {
  const isActive = !iteration.outcome;
  const outcomeInfo = formatOutcome(iteration.outcome);

  return (
    <div
      className={`border rounded-panel-sm overflow-hidden ${
        isActive
          ? "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950"
          : "border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <span
            className={`font-medium ${isActive ? "text-orange-700 dark:text-orange-300" : "text-stone-800 dark:text-stone-100"}`}
          >
            {titleCase(iteration.stage)} #{iteration.iteration_number}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              Active
            </span>
          )}
        </div>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {formatTimestamp(iteration.started_at)}
        </span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {outcomeInfo && (
          <div className="flex items-center gap-2">
            <span className="text-stone-500 dark:text-stone-400 text-sm">Outcome:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeInfo.color}`}>
              {outcomeInfo.label}
            </span>
          </div>
        )}
        {iteration.ended_at && (
          <div className="text-xs text-stone-400 dark:text-stone-500">
            Ended: {formatTimestamp(iteration.ended_at)}
          </div>
        )}
      </div>
    </div>
  );
}
