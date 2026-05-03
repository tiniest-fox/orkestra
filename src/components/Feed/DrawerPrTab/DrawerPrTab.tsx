//! PR tab body for the Feed task drawer — shows CI checks, reviews, comments,
//! conflicts, and drives the footer state for address-comments / fix-conflicts actions.

import { useCallback, useEffect, useState } from "react";
import { usePrStatus } from "../../../providers/PrStatusProvider";
import type { PrCheckData, PrCommentData } from "../../../types/workflow";
import { hasConflicts } from "../../../utils/prStatus";
import type { PrTabFooterState } from "../Drawer/drawerTabs";
import { groupCommentsByReview } from "../groupCommentsByReview";
import { ConflictPanel } from "./ConflictPanel";
import { PrChecksSection } from "./PrChecksSection";
import { PrGitSection } from "./PrGitSection";
import { PrReviewsSection } from "./PrReviewsSection";
import { PrStatusBar } from "./PrStatusBar";

// ============================================================================
// Component
// ============================================================================

interface DrawerPrTabProps {
  taskId: string;
  prUrl: string;
  baseBranch: string;
  branchName: string;
  onPrStateChange: (state: PrTabFooterState) => void;
}

export function DrawerPrTab({
  taskId,
  prUrl,
  baseBranch,
  branchName,
  onPrStateChange,
}: DrawerPrTabProps) {
  const { getPrStatus, isLoading, setActivePoll } = usePrStatus();

  // Activate 2s polling while this tab is mounted.
  useEffect(() => {
    setActivePoll(taskId);
    return () => setActivePoll(null);
  }, [taskId, setActivePoll]);

  const status = getPrStatus(taskId);
  const loading = isLoading(taskId);

  const conflicts = status ? hasConflicts(status) : false;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedCheckNames, setSelectedCheckNames] = useState<Set<string>>(new Set());
  const [guidance, setGuidance] = useState("");

  // Reset selection when task changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is the intentional trigger; setters are stable
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedCheckNames(new Set());
    setGuidance("");
  }, [taskId]);

  // Clear stale check selections when PR status refreshes.
  useEffect(() => {
    if (!status) return;
    const failingNames = new Set(
      status.checks.filter((c) => c.status === "failure").map((c) => c.name),
    );
    setSelectedCheckNames((prev) => {
      const next = new Set([...prev].filter((name) => failingNames.has(name)));
      return next.size !== prev.size ? next : prev;
    });
  }, [status]);

  // Clear stale comment selections when comments become outdated between polls.
  useEffect(() => {
    if (!status) return;
    const outdatedIds = new Set(status.comments.filter((c) => c.outdated).map((c) => c.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => !outdatedIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [status]);

  // Notify parent of footer state whenever relevant state changes.
  useEffect(() => {
    if (!status && loading) {
      onPrStateChange({ type: "loading" });
      return;
    }
    if (!status) {
      onPrStateChange({ type: "clean" });
      return;
    }
    if (conflicts) {
      onPrStateChange({ type: "conflicts" });
      return;
    }
    const hasSelection = selectedIds.size > 0 || selectedCheckNames.size > 0;
    if (hasSelection) {
      const allComments = status.comments;
      const comments: PrCommentData[] = allComments
        .filter((c) => selectedIds.has(c.id))
        .map((c) => ({
          author: c.author,
          body: c.body,
          path: c.path ?? null,
          line: c.line ?? null,
        }));
      const checks: PrCheckData[] = status.checks
        .filter((c) => selectedCheckNames.has(c.name))
        .map((c) => ({
          name: c.name,
          log_excerpt: c.log_excerpt ?? null,
        }));
      onPrStateChange({
        type: "feedback_selected",
        commentCount: selectedIds.size,
        checkCount: selectedCheckNames.size,
        comments,
        checks,
        guidance,
      });
      return;
    }
    onPrStateChange({ type: "clean" });
  }, [status, loading, conflicts, selectedIds, selectedCheckNames, guidance, onPrStateChange]);

  const toggleComment = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleCheck = useCallback((name: string) => {
    setSelectedCheckNames((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  if (!status && loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <span className="font-mono text-forge-mono-sm text-text-quaternary">
          Loading PR status…
        </span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <span className="font-mono text-forge-mono-sm text-text-quaternary">
          Unable to load PR status.
        </span>
      </div>
    );
  }

  const { reviewsWithComments, standaloneComments } = groupCommentsByReview(
    status.reviews,
    status.comments,
  );
  const allComments = status.comments;
  const hasReviewContent =
    reviewsWithComments.some((r) => r.comments.length > 0 || r.review.body) ||
    standaloneComments.length > 0;
  const allChecksPassing =
    status.checks.length > 0 && status.checks.every((c) => c.status === "success");
  const prNumber = extractPrNumber(prUrl);
  const anySelected = selectedIds.size > 0 || selectedCheckNames.size > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* PR state bar */}
      <PrStatusBar status={status} prNumber={prNumber} prUrl={prUrl} conflicts={conflicts} />

      {/* Git sync section — shows branch sync status and action buttons */}
      <PrGitSection taskId={taskId} branchName={branchName} />

      {/* Conflict panel — shown when conflicts exist, suppresses comments */}
      {conflicts && <ConflictPanel baseBranch={baseBranch} />}

      {/* CI checks */}
      {status.checks.length > 0 && (
        <PrChecksSection
          checks={status.checks}
          allPassing={allChecksPassing}
          compact={allChecksPassing && hasReviewContent}
          selectedCheckNames={selectedCheckNames}
          onToggleCheck={toggleCheck}
          suppressed={conflicts}
        />
      )}

      {/* Reviews and comments */}
      {hasReviewContent && (
        <PrReviewsSection
          reviewsWithComments={reviewsWithComments}
          standaloneComments={standaloneComments}
          allComments={allComments}
          selectedIds={selectedIds}
          onToggle={toggleComment}
          suppressed={conflicts}
        />
      )}

      {/* Shared guidance textarea — visible when any selection exists */}
      {anySelected && !conflicts && (
        <div className="px-6 pb-6">
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Optional guidance for the agent…"
            rows={2}
            className="w-full font-sans text-forge-mono-md text-text-primary placeholder:text-text-quaternary bg-canvas border border-border rounded px-3 py-2 resize-none focus:outline-none focus:border-text-tertiary transition-colors"
          />
        </div>
      )}

      {/* Empty state */}
      {!conflicts && !hasReviewContent && status.checks.length === 0 && (
        <div className="px-6 py-8 font-mono text-forge-mono-sm text-text-quaternary">
          No checks or reviews yet.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function extractPrNumber(prUrl: string): string | null {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? match[1] : null;
}
