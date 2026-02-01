/**
 * Iteration card - displays a single workflow iteration.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { formatTimestamp, titleCase } from "../../utils/formatters";

interface IterationCardProps {
  iteration: WorkflowIteration;
}

function formatOutcome(outcome: WorkflowIteration["outcome"]): {
  label: string;
  color: string;
} | null {
  if (!outcome) return null;

  switch (outcome.type) {
    case "approved":
      return {
        label: "Approved",
        color: "text-success-700 bg-success-50 dark:text-success-300 dark:bg-success-950",
      };
    case "rejected":
      return {
        label: "Rejected",
        color: "text-warning-700 bg-warning-50 dark:text-warning-300 dark:bg-warning-950",
      };
    case "awaiting_answers":
      return {
        label: "Awaiting Answers",
        color: "text-info-700 bg-info-50 dark:text-info-300 dark:bg-info-950",
      };
    case "completed":
      return {
        label: "Completed",
        color: "text-success-700 bg-success-50 dark:text-success-300 dark:bg-success-950",
      };
    case "integration_failed":
      return {
        label: "Integration Failed",
        color: "text-error-700 bg-error-50 dark:text-error-300 dark:bg-error-950",
      };
    case "agent_error":
      return {
        label: "Agent Error",
        color: "text-error-700 bg-error-50 dark:text-error-300 dark:bg-error-950",
      };
    case "blocked":
      return {
        label: "Blocked",
        color: "text-warning-700 bg-warning-50 dark:text-warning-300 dark:bg-warning-950",
      };
    case "skipped":
      return {
        label: "Skipped",
        color: "text-gray-700 bg-gray-50 dark:text-gray-300 dark:bg-gray-900",
      };
    case "rejection":
      return {
        label: `Rejected → ${outcome.target}`,
        color: "text-purple-700 bg-purple-50 dark:text-purple-300 dark:bg-purple-950",
      };
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
