//! PR tab body for the Feed task drawer — shows CI checks, reviews, comments,
//! conflicts, and drives the footer state for address-comments / fix-conflicts actions.

import { useCallback, useEffect, useState } from "react";
import { usePrStatus } from "../../../providers/PrStatusProvider";
import type { PrCommentData, PrStatus } from "../../../types/workflow";
import type { PrTabFooterState } from "../Drawer/drawerTabs";
import { groupCommentsByReview } from "../groupCommentsByReview";
import { ConflictPanel } from "./ConflictPanel";
import { PrChecksSection } from "./PrChecksSection";
import { PrReviewsSection } from "./PrReviewsSection";
import { PrStatusBar } from "./PrStatusBar";

export type { PrTabFooterState };

// ============================================================================
// Component
// ============================================================================

interface DrawerPrTabProps {
  taskId: string;
  prUrl: string;
  baseBranch: string;
  onPrStateChange: (state: PrTabFooterState) => void;
}

export function DrawerPrTab({ taskId, prUrl, baseBranch, onPrStateChange }: DrawerPrTabProps) {
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
  const [guidance, setGuidance] = useState("");

  // Reset selection when task changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is the intentional trigger; setters are stable
  useEffect(() => {
    setSelectedIds(new Set());
    setGuidance("");
  }, [taskId]);

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
    if (selectedIds.size > 0) {
      const allComments = status.comments;
      const comments: PrCommentData[] = allComments
        .filter((c) => selectedIds.has(c.id))
        .map((c) => ({
          author: c.author,
          body: c.body,
          path: c.path ?? null,
          line: c.line ?? null,
        }));
      onPrStateChange({ type: "comments_selected", count: selectedIds.size, comments, guidance });
      return;
    }
    onPrStateChange({ type: "clean" });
  }, [status, loading, conflicts, selectedIds, guidance, onPrStateChange]);

  const toggleComment = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  if (!status && loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <span className="font-mono text-[11px] text-text-quaternary">Loading PR status…</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <span className="font-mono text-[11px] text-text-quaternary">
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

  return (
    <div className="flex-1 overflow-y-auto">
      {/* PR state bar */}
      <PrStatusBar status={status} prNumber={prNumber} prUrl={prUrl} conflicts={conflicts} />

      {/* Conflict panel — shown when conflicts exist, suppresses comments */}
      {conflicts && <ConflictPanel baseBranch={baseBranch} />}

      {/* CI checks */}
      {status.checks.length > 0 && (
        <PrChecksSection
          checks={status.checks}
          allPassing={allChecksPassing}
          compact={allChecksPassing && hasReviewContent}
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
          guidance={guidance}
          onGuidanceChange={setGuidance}
          suppressed={conflicts}
        />
      )}

      {/* Empty state */}
      {!conflicts && !hasReviewContent && status.checks.length === 0 && (
        <div className="px-6 py-8 font-mono text-[11px] text-text-quaternary">
          No checks or reviews yet.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function hasConflicts(status: PrStatus): boolean {
  return status.merge_state_status === "DIRTY" || status.mergeable === false;
}

function extractPrNumber(prUrl: string): string | null {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? match[1] : null;
}
