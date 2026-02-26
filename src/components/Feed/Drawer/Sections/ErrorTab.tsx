//! Error details tab for failed tasks — shows the failed stage, error message, and outcome detail.

import type { WorkflowOutcome, WorkflowTaskView } from "../../../../types/workflow";

// ============================================================================
// Helpers
// ============================================================================

function outcomeDetail(outcome: WorkflowOutcome): string | null {
  switch (outcome.type) {
    case "agent_error":
      return `Agent error: ${outcome.error}`;
    case "spawn_failed":
      return `Failed to start agent: ${outcome.error}`;
    case "gate_failed":
      return `Gate failed in ${outcome.stage}: ${outcome.error}`;
    case "integration_failed":
      return outcome.conflict_files.length > 0
        ? `Integration failed: ${outcome.error}\n\nConflicting files:\n${outcome.conflict_files.join("\n")}`
        : `Integration failed: ${outcome.error}`;
    case "commit_failed":
      return `Commit failed: ${outcome.error}`;
    case "blocked":
      return `Blocked: ${outcome.reason}`;
    default:
      return outcome.type;
  }
}

// ============================================================================
// Component
// ============================================================================

interface ErrorTabProps {
  task: WorkflowTaskView;
  bodyRef: React.RefObject<HTMLDivElement>;
}

export function ErrorTab({ task, bodyRef }: ErrorTabProps) {
  const lastIteration =
    task.iterations.length > 0 ? task.iterations[task.iterations.length - 1] : null;

  const failedStage = lastIteration?.stage ?? null;

  const stateError = task.state.type === "failed" ? task.state.error : undefined;

  const detail = lastIteration?.outcome ? outcomeDetail(lastIteration.outcome) : null;

  const hasDetail = stateError || detail;

  return (
    <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-status-error uppercase tracking-wide">
          Failed
        </span>
        {failedStage && (
          <>
            <span className="text-text-quaternary font-mono text-[11px]">·</span>
            <span className="font-mono text-[11px] text-text-tertiary">{failedStage}</span>
          </>
        )}
      </div>

      {hasDetail ? (
        <pre className="font-mono text-[11px] text-text-secondary whitespace-pre-wrap break-words bg-surface-secondary rounded-panel-sm px-3 py-2.5 leading-relaxed">
          {stateError ?? detail}
        </pre>
      ) : (
        <p className="font-mono text-[11px] text-text-quaternary">
          Stage failed with no error details.
        </p>
      )}

      {stateError && detail && stateError !== detail && (
        <pre className="font-mono text-[11px] text-text-tertiary whitespace-pre-wrap break-words bg-surface-secondary rounded-panel-sm px-3 py-2.5 leading-relaxed">
          {detail}
        </pre>
      )}
    </div>
  );
}
