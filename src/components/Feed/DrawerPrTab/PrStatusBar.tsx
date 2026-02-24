//! Status badge bar at the top of the PR tab — shows merge state, PR number, and GitHub link.

import type { PrStatus } from "../../../types/workflow";

type BadgeVariant = "merged" | "closed" | "conflicts" | "failing" | "approved" | "open";

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  merged: "text-accent bg-accent-soft border border-accent/30",
  closed: "text-text-tertiary bg-canvas border border-border",
  conflicts: "text-status-warning bg-status-warning-bg border border-status-warning/40",
  failing: "text-status-error bg-status-error-bg border border-status-error/40",
  approved: "text-status-success bg-status-success-bg border border-status-success/40",
  open: "text-status-info bg-status-info-bg border border-status-info/40",
};

interface PrStatusBarProps {
  status: PrStatus;
  prNumber: string | null;
  prUrl: string;
  conflicts: boolean;
}

export function PrStatusBar({ status, prNumber, prUrl, conflicts }: PrStatusBarProps) {
  const approved = status.reviews.some((r) => r.state === "APPROVED");
  const changesRequested = status.reviews.some((r) => r.state === "CHANGES_REQUESTED");
  const anyFailing = status.checks.some((c) => c.status === "failure");

  let badgeText: string;
  let badgeVariant: BadgeVariant;

  if (status.state === "merged") {
    badgeText = "Merged";
    badgeVariant = "merged";
  } else if (status.state === "closed") {
    badgeText = "Closed";
    badgeVariant = "closed";
  } else if (conflicts) {
    badgeText = "Conflicts";
    badgeVariant = "conflicts";
  } else if (anyFailing) {
    badgeText = "Checks failing";
    badgeVariant = "failing";
  } else if (changesRequested) {
    badgeText = "Changes requested";
    badgeVariant = "failing";
  } else if (approved) {
    badgeText = "Approved";
    badgeVariant = "approved";
  } else {
    badgeText = "Open";
    badgeVariant = "open";
  }

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
      <span
        className={`font-mono text-[10px] font-medium px-2 py-0.5 rounded ${BADGE_CLASSES[badgeVariant]}`}
      >
        {badgeText}
      </span>
      {prNumber && <span className="font-mono text-[11px] text-text-tertiary">#{prNumber}</span>}
      <a
        href={prUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-auto font-mono text-[10px] text-text-quaternary hover:text-text-secondary transition-colors"
      >
        GitHub ↗
      </a>
    </div>
  );
}
