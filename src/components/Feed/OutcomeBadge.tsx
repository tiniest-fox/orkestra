// Outcome badge — colored label for iteration outcomes and artifact states.

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

export function artifactBadgeLabel(
  artifactName: string,
  verdict?: "approved" | "rejected",
  rejectionTarget?: string,
): { label: string; classes: string } {
  if (verdict === "approved") {
    return { label: "Approved", classes: "bg-status-success text-white" };
  }
  if (verdict === "rejected") {
    if (rejectionTarget) {
      const stage = rejectionTarget.replace(/\b\w/g, (c) => c.toUpperCase());
      return { label: `Rejected → ${stage}`, classes: "bg-status-error text-white" };
    }
    return { label: "Rejected", classes: "bg-status-error text-white" };
  }
  // Non-approval artifact or no verdict yet: show title-cased artifact name
  const label = artifactName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, classes: "bg-surface-3 text-text-secondary" };
}

export function ArtifactBadge({
  artifactName,
  verdict,
  rejectionTarget,
}: {
  artifactName: string;
  verdict?: "approved" | "rejected";
  rejectionTarget?: string;
}) {
  const { label, classes } = artifactBadgeLabel(artifactName, verdict, rejectionTarget);
  return (
    <span
      className={`font-mono text-forge-mono-label font-medium px-1.5 py-0.5 rounded ${classes}`}
    >
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
      return { label: "Rejected", color: "text-status-warning" };
    case "rejection": {
      const { from_stage, target } = outcome;
      if (target && target !== from_stage) {
        const stage = target.replace(/\b\w/g, (c) => c.toUpperCase());
        return { label: `Rejected → ${stage}`, color: "text-status-warning" };
      }
      return { label: "Rejected", color: "text-status-warning" };
    }
    case "awaiting_rejection_review": {
      const { from_stage, target } = outcome;
      if (target && target !== from_stage) {
        const stage = target.replace(/\b\w/g, (c) => c.toUpperCase());
        return { label: `Pending Review → ${stage}`, color: "text-status-warning" };
      }
      return { label: "Pending Review", color: "text-status-warning" };
    }
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
