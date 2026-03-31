// Outcome badge — colored label for iteration outcomes.

import type { WorkflowOutcome } from "../../types/workflow";

export function OutcomeBadge({ outcome }: { outcome?: WorkflowOutcome }) {
  if (!outcome) return null;
  const { label, color } = badgeLabel(outcome);
  return (
    <span className={`font-mono text-forge-mono-label px-1.5 py-0.5 rounded bg-canvas ${color}`}>
      {label}
    </span>
  );
}

export function badgeLabel(outcome: WorkflowOutcome): { label: string; color: string } {
  switch (outcome.type) {
    case "approved":
      return { label: "Approved", color: "text-status-success" };
    case "completed":
      return { label: "Done", color: "text-status-success" };
    case "rejected":
    case "rejection":
      return { label: "Rejected", color: "text-status-warning" };
    case "awaiting_rejection_review":
      return { label: "Pending Review", color: "text-status-warning" };
    case "awaiting_answers":
      return { label: "Waiting", color: "text-status-info" };
    case "interrupted":
      return { label: "Interrupted", color: "text-status-warning" };
    case "agent_error":
      return { label: "Error", color: "text-status-error" };
    case "spawn_failed":
      return { label: "Spawn Failed", color: "text-status-error" };
    case "gate_failed":
      return { label: "Gate Failed", color: "text-status-error" };
    case "commit_failed":
      return { label: "Commit Failed", color: "text-status-error" };
    case "integration_failed":
      return { label: "Merge Failed", color: "text-status-error" };
    case "blocked":
      return { label: "Blocked", color: "text-text-quaternary" };
    case "skipped":
      return { label: "Skipped", color: "text-text-quaternary" };
    default:
      return { label: "Unknown", color: "text-text-quaternary" };
  }
}
