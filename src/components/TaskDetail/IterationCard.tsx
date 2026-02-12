/**
 * Iteration card - displays a single workflow iteration.
 */

import type { IterationTrigger, WorkflowIteration } from "../../types/workflow";
import { formatTimestamp, titleCase } from "../../utils/formatters";
import {
  getOutcomeBadgeColor,
  getOutcomeSemantic,
  outcomeLabel,
} from "../../utils/iterationOutcomes";

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
  const label =
    outcome.type === "rejection"
      ? `${outcomeLabel(outcome)} → ${outcome.target}`
      : outcomeLabel(outcome);

  return { label, color };
}

function formatIncomingContext(context: IterationTrigger): {
  label: string;
  message: string;
} | null {
  switch (context.type) {
    case "manual_resume":
      return context.message ? { label: "You wrote:", message: context.message } : null;
    case "feedback":
      return { label: "Your feedback:", message: context.feedback };
    case "rejection":
      return {
        label: `Rejection from ${context.from_stage}:`,
        message: context.feedback,
      };
    case "retry_failed":
      return context.instructions
        ? { label: "Retry instructions:", message: context.instructions }
        : null;
    case "retry_blocked":
      return context.instructions
        ? { label: "Retry instructions:", message: context.instructions }
        : null;
    case "script_failure":
      return {
        label: `Script failed (${context.from_stage}):`,
        message: context.error,
      };
    case "integration":
      return {
        label: "Integration failed:",
        message: `${context.message}\nConflict files: ${context.conflict_files.join(", ")}`,
      };
    // These triggers have no meaningful display content
    case "interrupted":
    case "answers":
      return null;
  }
}

export function IterationCard({ iteration }: IterationCardProps) {
  const isActive = !iteration.outcome;
  const outcomeInfo = formatOutcome(iteration.outcome);
  const contextInfo = iteration.incoming_context
    ? formatIncomingContext(iteration.incoming_context)
    : null;

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
        {contextInfo && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded px-2 py-1.5">
            <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">
              {contextInfo.label}
            </div>
            <div className="text-sm text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
              {contextInfo.message}
            </div>
          </div>
        )}
        {outcomeInfo && (
          <div className="flex items-center gap-2">
            <span className="text-stone-500 dark:text-stone-400 text-sm">Outcome:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeInfo.color}`}>
              {outcomeInfo.label}
            </span>
          </div>
        )}
        {iteration.activity_log && (
          <details className="mt-2">
            <summary className="text-xs font-medium text-stone-500 dark:text-stone-400 cursor-pointer hover:text-stone-700 dark:hover:text-stone-200">
              Activity Summary
            </summary>
            <div className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap bg-stone-50 dark:bg-stone-800 rounded px-2 py-1.5 mt-1 border border-stone-100 dark:border-stone-700">
              {iteration.activity_log}
            </div>
          </details>
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
