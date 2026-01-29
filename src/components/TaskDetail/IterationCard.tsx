/**
 * Iteration card - displays a single workflow iteration.
 */

import type { WorkflowIteration } from "../../types/workflow";
import { capitalizeFirst } from "../../types/workflow";
import { formatTimestamp } from "../../utils/formatters";

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
      return { label: "Approved", color: "text-green-700 bg-green-50" };
    case "rejected":
      return { label: "Rejected", color: "text-amber-700 bg-amber-50" };
    case "awaiting_answers":
      return { label: "Awaiting Answers", color: "text-blue-700 bg-blue-50" };
    case "completed":
      return { label: "Completed", color: "text-green-700 bg-green-50" };
    case "integration_failed":
      return { label: "Integration Failed", color: "text-red-700 bg-red-50" };
    case "agent_error":
      return { label: "Agent Error", color: "text-red-700 bg-red-50" };
    case "blocked":
      return { label: "Blocked", color: "text-orange-700 bg-orange-50" };
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
        isActive ? "border-sage-300 bg-sage-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isActive ? "text-sage-700" : "text-stone-800"}`}>
            {capitalizeFirst(iteration.stage)} #{iteration.iteration_number}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-sage-600">
              <span className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-pulse" />
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
