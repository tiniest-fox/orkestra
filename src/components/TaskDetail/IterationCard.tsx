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
      return { label: "Approved", color: "text-success-700 bg-success-50" };
    case "rejected":
      return { label: "Rejected", color: "text-warning-700 bg-warning-50" };
    case "awaiting_answers":
      return { label: "Awaiting Answers", color: "text-info-700 bg-info-50" };
    case "completed":
      return { label: "Completed", color: "text-success-700 bg-success-50" };
    case "integration_failed":
      return { label: "Integration Failed", color: "text-error-700 bg-error-50" };
    case "agent_error":
      return { label: "Agent Error", color: "text-error-700 bg-error-50" };
    case "blocked":
      return { label: "Blocked", color: "text-warning-700 bg-warning-50" };
    case "skipped":
      return { label: "Skipped", color: "text-gray-700 bg-gray-50" };
    case "restage":
      return { label: `Restage to ${outcome.target}`, color: "text-purple-700 bg-purple-50" };
  }
}

export function IterationCard({ iteration }: IterationCardProps) {
  const isActive = !iteration.outcome;
  const outcomeInfo = formatOutcome(iteration.outcome);

  return (
    <div
      className={`border rounded-panel-sm overflow-hidden ${
        isActive ? "border-orange-300 bg-orange-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isActive ? "text-orange-700" : "text-stone-800"}`}>
            {titleCase(iteration.stage)} #{iteration.iteration_number}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-orange-600">
              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              Active
            </span>
          )}
        </div>
        <span className="text-xs text-stone-500">{formatTimestamp(iteration.started_at)}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {outcomeInfo && (
          <div className="flex items-center gap-2">
            <span className="text-stone-500 text-sm">Outcome:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeInfo.color}`}>
              {outcomeInfo.label}
            </span>
          </div>
        )}
        {iteration.ended_at && (
          <div className="text-xs text-stone-400">Ended: {formatTimestamp(iteration.ended_at)}</div>
        )}
      </div>
    </div>
  );
}
