//! PR tab body for the Feed task drawer — shows CI checks, reviews, comments,
//! conflicts, and drives the footer state for address-comments / fix-conflicts actions.

import { useCallback, useEffect, useState } from "react";
import { groupCommentsByReview } from "../TaskDetail/groupCommentsByReview";
import { usePrStatus } from "../../providers/PrStatusProvider";
import type { PrComment, PrCommentData, PrCheck, PrReview, PrStatus } from "../../types/workflow";

// ============================================================================
// Public types
// ============================================================================

export type PrTabFooterState =
  | { type: "loading" }
  | { type: "no_pr" }
  | { type: "conflicts" }
  | { type: "comments_selected"; count: number; comments: PrCommentData[]; guidance: string }
  | { type: "clean" };

// ============================================================================
// DrawerPrTab
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
        <span className="font-forge-mono text-[11px] text-[var(--text-3)]">Loading PR status…</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <span className="font-forge-mono text-[11px] text-[var(--text-3)]">
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
      <PrStatusBar status={status} prNumber={prNumber} prUrl={prUrl} />

      {/* Conflict panel — shown when conflicts exist, suppresses comments */}
      {conflicts && <ConflictPanel baseBranch={baseBranch} />}

      {/* CI checks */}
      {status.checks.length > 0 && (
        <ChecksSection
          checks={status.checks}
          allPassing={allChecksPassing}
          compact={allChecksPassing && hasReviewContent}
        />
      )}

      {/* Reviews and comments */}
      {hasReviewContent && (
        <ReviewsSection
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
        <div className="px-6 py-8 font-forge-mono text-[11px] text-[var(--text-3)]">
          No checks or reviews yet.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PrStatusBar
// ============================================================================

function PrStatusBar({
  status,
  prNumber,
  prUrl,
}: {
  status: PrStatus;
  prNumber: string | null;
  prUrl: string;
}) {
  const approved = status.reviews.some((r) => r.state === "APPROVED");
  const changesRequested = status.reviews.some((r) => r.state === "CHANGES_REQUESTED");
  const anyFailing = status.checks.some((c) => c.status === "failure");
  const conflicts = hasConflicts(status);

  let badgeText: string;
  let badgeStyle: React.CSSProperties;

  if (status.state === "merged") {
    badgeText = "Merged";
    badgeStyle = {
      color: "var(--accent-2)",
      background: "var(--accent-2-bg)",
      border: "1px solid rgba(166,60,181,0.3)",
    };
  } else if (status.state === "closed") {
    badgeText = "Closed";
    badgeStyle = {
      color: "var(--text-2)",
      background: "var(--surface-3)",
      border: "1px solid var(--border)",
    };
  } else if (conflicts) {
    badgeText = "Conflicts";
    badgeStyle = {
      color: "var(--amber)",
      background: "var(--amber-bg)",
      border: "1px solid var(--amber-border)",
    };
  } else if (anyFailing) {
    badgeText = "Checks failing";
    badgeStyle = {
      color: "var(--red)",
      background: "var(--red-bg)",
      border: "1px solid var(--red-border)",
    };
  } else if (changesRequested) {
    badgeText = "Changes requested";
    badgeStyle = {
      color: "var(--red)",
      background: "var(--red-bg)",
      border: "1px solid var(--red-border)",
    };
  } else if (approved) {
    badgeText = "Approved";
    badgeStyle = {
      color: "var(--green)",
      background: "var(--green-bg)",
      border: "1px solid var(--green-border)",
    };
  } else {
    badgeText = "Open";
    badgeStyle = {
      color: "var(--blue)",
      background: "var(--blue-bg)",
      border: "1px solid var(--blue-border)",
    };
  }

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)]">
      <span
        className="font-forge-mono text-[10px] font-medium px-2 py-0.5 rounded"
        style={badgeStyle}
      >
        {badgeText}
      </span>
      {prNumber && (
        <span className="font-forge-mono text-[11px] text-[var(--text-2)]">#{prNumber}</span>
      )}
      <a
        href={prUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-auto font-forge-mono text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
      >
        GitHub ↗
      </a>
    </div>
  );
}

// ============================================================================
// ConflictPanel
// ============================================================================

function ConflictPanel({ baseBranch }: { baseBranch: string }) {
  return (
    <div
      className="mx-6 my-4 px-4 py-3 rounded-lg border"
      style={{ background: "var(--amber-bg)", borderColor: "var(--amber-border)" }}
    >
      <div className="font-forge-sans text-[12px] font-semibold text-[var(--amber)] mb-1">
        Merge conflicts
      </div>
      <p className="font-forge-sans text-[12px] text-[var(--text-1)] leading-relaxed">
        This branch has conflicts with{" "}
        <span className="font-forge-mono text-[11px] bg-[var(--surface-3)] px-1 py-0.5 rounded">
          {baseBranch}
        </span>
        . Use "Fix Conflicts" to send the task back to the agent for resolution.
      </p>
    </div>
  );
}

// ============================================================================
// ChecksSection
// ============================================================================

function ChecksSection({
  checks,
  allPassing,
  compact,
}: {
  checks: PrCheck[];
  allPassing: boolean;
  compact: boolean;
}) {
  if (compact && allPassing) {
    return (
      <div className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-2">
        <span className="text-[var(--green)] text-[12px]">✓</span>
        <span className="font-forge-mono text-[10px] text-[var(--text-3)]">
          All checks passed · {checks.length} {checks.length === 1 ? "run" : "runs"}
        </span>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border)]">
      <div className="px-6 pt-4 pb-2 font-forge-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-3)]">
        Checks
      </div>
      <div className="divide-y divide-[var(--border)]">
        {checks.map((check, i) => (
          <CheckRow key={i} check={check} />
        ))}
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: PrCheck }) {
  const isFailing = check.status === "failure";
  const isPending = check.status === "pending";

  let icon: string;
  let iconColor: string;
  if (check.status === "success") {
    icon = "✓";
    iconColor = "var(--green)";
  } else if (check.status === "failure") {
    icon = "✕";
    iconColor = "var(--red)";
  } else if (check.status === "skipped") {
    icon = "–";
    iconColor = "var(--text-3)";
  } else {
    icon = "·";
    iconColor = "var(--amber)";
  }

  return (
    <div
      className="flex items-center gap-3 px-6 py-2.5"
      style={isFailing ? { background: "var(--red-bg)" } : undefined}
    >
      <span
        className="font-forge-mono text-[12px] w-4 shrink-0 text-center"
        style={{ color: iconColor }}
      >
        {icon}
      </span>
      <span className="font-forge-mono text-[11px] text-[var(--text-1)] flex-1 min-w-0 truncate">
        {check.name}
      </span>
      {isPending && (
        <span className="font-forge-mono text-[10px] text-[var(--amber)]">running</span>
      )}
      {isFailing && check.conclusion && (
        <span className="font-forge-mono text-[10px] text-[var(--red)] truncate max-w-[160px]">
          {check.conclusion}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// ReviewsSection
// ============================================================================

interface ReviewsSectionProps {
  reviewsWithComments: Array<{ review: PrReview; comments: PrComment[] }>;
  standaloneComments: PrComment[];
  allComments: PrComment[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  guidance: string;
  onGuidanceChange: (v: string) => void;
  suppressed: boolean;
}

function ReviewsSection({
  reviewsWithComments,
  standaloneComments,
  allComments,
  selectedIds,
  onToggle,
  guidance,
  onGuidanceChange,
  suppressed,
}: ReviewsSectionProps) {
  const hasComments = allComments.length > 0;
  const selectionCount = selectedIds.size;

  return (
    <div style={suppressed ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <span className="font-forge-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-3)]">
          Reviews
        </span>
        {suppressed && (
          <span className="font-forge-mono text-[10px] text-[var(--amber)]">
            resolve conflicts first
          </span>
        )}
      </div>

      {/* Selection summary */}
      {!suppressed && selectionCount > 0 && (
        <div className="mx-6 mb-3 px-3 py-2 rounded bg-[var(--surface-2)] border border-[var(--border)] font-forge-mono text-[10px] text-[var(--text-1)]">
          {selectionCount} of {allComments.length} comment{allComments.length !== 1 ? "s" : ""}{" "}
          selected to address
        </div>
      )}

      {/* Reviews with their comments */}
      {reviewsWithComments.map(({ review, comments }) => (
        <div key={review.id} className="px-6 mb-4">
          <ReviewHeader review={review} />
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedIds.has(comment.id)}
              onToggle={onToggle}
              suppressed={suppressed}
              dimmed={selectionCount > 0 && !selectedIds.has(comment.id)}
            />
          ))}
        </div>
      ))}

      {/* Standalone comments */}
      {standaloneComments.length > 0 && (
        <div className="px-6 mb-4">
          {standaloneComments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedIds.has(comment.id)}
              onToggle={onToggle}
              suppressed={suppressed}
              dimmed={selectionCount > 0 && !selectedIds.has(comment.id)}
            />
          ))}
        </div>
      )}

      {/* Guidance textarea — only shown when comments are available and not suppressed */}
      {hasComments && !suppressed && (
        <div className="px-6 pb-6">
          <textarea
            value={guidance}
            onChange={(e) => onGuidanceChange(e.target.value)}
            placeholder="Optional guidance for the agent…"
            rows={2}
            className="w-full font-forge-sans text-[12px] text-[var(--text-0)] placeholder:text-[var(--text-3)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-3 py-2 resize-none focus:outline-none focus:border-[var(--text-2)] transition-colors"
          />
        </div>
      )}
    </div>
  );
}

function ReviewHeader({ review }: { review: PrReview }) {
  const stateLabel: Record<string, string> = {
    APPROVED: "approved",
    CHANGES_REQUESTED: "requested changes",
    COMMENTED: "commented",
    PENDING: "pending",
  };
  const stateColor: Record<string, string> = {
    APPROVED: "var(--green)",
    CHANGES_REQUESTED: "var(--red)",
    COMMENTED: "var(--text-2)",
    PENDING: "var(--text-3)",
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-forge-mono text-[11px] font-medium text-[var(--text-1)]">
        {review.author}
      </span>
      <span
        className="font-forge-mono text-[10px]"
        style={{ color: stateColor[review.state] ?? "var(--text-3)" }}
      >
        {stateLabel[review.state] ?? review.state.toLowerCase()}
      </span>
    </div>
  );
}

function CommentRow({
  comment,
  selected,
  onToggle,
  suppressed,
  dimmed,
}: {
  comment: PrComment;
  selected: boolean;
  onToggle: (id: number) => void;
  suppressed: boolean;
  dimmed: boolean;
}) {
  return (
    <label
      className="flex gap-3 py-2.5 px-3 rounded-lg mb-1.5 border cursor-pointer transition-all"
      style={{
        opacity: dimmed ? 0.45 : 1,
        background: selected ? "var(--surface-2)" : "transparent",
        borderColor: selected ? "var(--border)" : "transparent",
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(comment.id)}
        disabled={suppressed}
        className="mt-0.5 shrink-0 accent-[var(--peach)]"
      />
      <div className="min-w-0 flex-1">
        {comment.path && (
          <div className="font-forge-mono text-[10px] text-[var(--text-3)] mb-1 truncate">
            {comment.path}
            {comment.line != null ? `:${comment.line}` : ""}
          </div>
        )}
        <p className="font-forge-sans text-[12px] text-[var(--text-1)] leading-relaxed break-words">
          {comment.body}
        </p>
        <div className="font-forge-mono text-[10px] text-[var(--text-3)] mt-1">
          {comment.author}
        </div>
      </div>
    </label>
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
