/**
 * PR tab - displays pull request status, checks, and reviews.
 */

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  Loader2,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { usePrStatus } from "../../providers";
import type { PrCheck, PrComment, PrReview } from "../../types/workflow";
import { Badge, CollapsibleSection, FlexContainer, Link, Panel } from "../ui";
import { groupCommentsByReview } from "./groupCommentsByReview";

interface PrTabProps {
  prUrl: string;
  taskId: string;
  /** Currently selected comment IDs. */
  selectedCommentIds?: Set<number>;
  /** Callback when comment selection changes. */
  onSelectionChange?: (ids: Set<number>) => void;
  /** Current guidance text. */
  guidance?: string;
  /** Callback when guidance changes. */
  onGuidanceChange?: (guidance: string) => void;
}

export function PrTab({
  prUrl,
  taskId,
  selectedCommentIds,
  onSelectionChange,
  guidance,
  onGuidanceChange,
}: PrTabProps) {
  const { getPrStatus, isLoading } = usePrStatus();
  const status = getPrStatus(taskId);
  const loading = isLoading(taskId);

  // Manage expansion state for each review
  const [expandedReviews, setExpandedReviews] = useState<Set<number>>(new Set());

  const toggleReview = (id: number) => {
    setExpandedReviews((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { reviewsWithComments, standaloneComments } = useMemo(
    () => groupCommentsByReview(status?.reviews ?? [], status?.comments ?? []),
    [status?.reviews, status?.comments],
  );

  const hasAnyComments =
    standaloneComments.length > 0 || reviewsWithComments.some((r) => r.comments.length > 0);

  return (
    <FlexContainer direction="vertical" padded={true} gap={12} scrolls={true}>
      {/* Header with state badge and link */}
      <Panel
        accent={stateToAccent(status?.state)}
        autoFill={false}
        padded={true}
        className="flex-shrink-0"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StateBadge state={status?.state} isLoading={loading && !status} />
            {!status && loading && (
              <span className="text-sm text-stone-500 dark:text-stone-400">Loading...</span>
            )}
          </div>
          <Link href={prUrl} external className="text-sm">
            <ExternalLink className="w-4 h-4 inline mr-1" />
            View on GitHub
          </Link>
        </div>
      </Panel>

      {/* CI Checks section */}
      {status?.checks && status.checks.length > 0 && (
        <CollapsibleSection title="Checks" count={status.checks.length} className="flex-shrink-0">
          <Panel autoFill={false} padded={true}>
            <div className="space-y-1">
              {status.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Reviews section with nested comments */}
      {reviewsWithComments.length > 0 && (
        <CollapsibleSection
          title="Reviews"
          count={reviewsWithComments.length}
          className="flex-shrink-0"
          defaultExpanded={true}
        >
          <Panel autoFill={false} padded={true}>
            <div className="space-y-3">
              {reviewsWithComments.map(({ review, comments }) => (
                <ReviewRow
                  key={review.id}
                  review={review}
                  comments={comments}
                  expanded={expandedReviews.has(review.id)}
                  onToggle={() => toggleReview(review.id)}
                  selectedCommentIds={selectedCommentIds}
                  onCommentToggle={(id) => {
                    const newSet = new Set(selectedCommentIds);
                    if (newSet.has(id)) newSet.delete(id);
                    else newSet.add(id);
                    onSelectionChange?.(newSet);
                  }}
                />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Standalone Comments section */}
      {standaloneComments.length > 0 && (
        <CollapsibleSection
          title="Standalone Comments"
          count={standaloneComments.length}
          className="flex-shrink-0"
        >
          <Panel autoFill={false} padded={true}>
            <div className="space-y-3">
              {standaloneComments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  selected={selectedCommentIds?.has(comment.id) ?? false}
                  onToggle={() => {
                    const newSet = new Set(selectedCommentIds);
                    if (newSet.has(comment.id)) newSet.delete(comment.id);
                    else newSet.add(comment.id);
                    onSelectionChange?.(newSet);
                  }}
                />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Guidance section - show when there are any comments */}
      {hasAnyComments && (
        <Panel autoFill={false} padded={true} className="flex-shrink-0">
          <h4 className="text-sm font-medium mb-2 text-stone-700 dark:text-stone-300">
            Guidance (optional)
          </h4>
          <textarea
            value={guidance ?? ""}
            onChange={(e) => onGuidanceChange?.(e.target.value)}
            placeholder="Add any additional context or instructions..."
            className="w-full h-20 text-sm rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 p-2 resize-none"
          />
        </Panel>
      )}

      {/* Empty state for no checks/reviews/comments */}
      {status &&
        status.checks.length === 0 &&
        reviewsWithComments.length === 0 &&
        standaloneComments.length === 0 && (
          <div className="flex-shrink-0 text-sm text-stone-500 dark:text-stone-400 text-center py-4">
            No checks, reviews, or comments yet
          </div>
        )}
    </FlexContainer>
  );
}

function stateToAccent(state?: string): "none" | "info" | "warning" | "error" {
  if (!state) return "none";
  if (state === "merged") return "info";
  if (state === "closed") return "error";
  return "none"; // open
}

function StateBadge({ state, isLoading }: { state?: string; isLoading: boolean }) {
  if (isLoading && !state) {
    return <Badge variant="waiting">Loading...</Badge>;
  }
  const variant = state === "merged" ? "done" : state === "closed" ? "failed" : "working";
  const label = state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown";
  return <Badge variant={variant}>{label}</Badge>;
}

function CheckRow({ check }: { check: PrCheck }) {
  const icon =
    check.status === "success" ? (
      <CheckCircle2 className="w-4 h-4 text-success-500" />
    ) : check.status === "failure" ? (
      <XCircle className="w-4 h-4 text-error-500" />
    ) : check.status === "pending" ? (
      <Loader2 className="w-4 h-4 text-stone-400 dark:text-stone-500 animate-spin" />
    ) : (
      <Circle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    );

  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-stone-700 dark:text-stone-300">{check.name}</span>
    </div>
  );
}

function ReviewRow({
  review,
  comments,
  expanded,
  onToggle,
  selectedCommentIds,
  onCommentToggle,
}: {
  review: PrReview;
  comments?: PrComment[];
  expanded?: boolean;
  onToggle?: () => void;
  selectedCommentIds?: Set<number>;
  onCommentToggle?: (id: number) => void;
}) {
  const hasComments = comments && comments.length > 0;
  const selectedCount = hasComments
    ? comments.filter((c) => selectedCommentIds?.has(c.id)).length
    : 0;

  const normalizedState = review.state.toLowerCase();
  const icon =
    normalizedState === "approved" ? (
      <CheckCircle2 className="w-4 h-4 text-success-500" />
    ) : normalizedState === "changes_requested" ? (
      <AlertCircle className="w-4 h-4 text-warning-500" />
    ) : normalizedState === "commented" ? (
      <MessageCircle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    ) : (
      <Circle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
    );

  const stateLabel =
    normalizedState === "approved"
      ? "approved"
      : normalizedState === "changes_requested"
        ? "requested changes"
        : normalizedState === "commented"
          ? "commented"
          : "pending";

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        {hasComments && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Collapse comments" : "Expand comments"}
            className="p-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        {icon}
        <span className="font-medium text-stone-700 dark:text-stone-300">{review.author}</span>
        <span className="text-stone-500 dark:text-stone-400">{stateLabel}</span>
        {hasComments && (
          <span className="text-xs text-stone-500 dark:text-stone-400">
            ({comments.length} comment{comments.length !== 1 ? "s" : ""})
          </span>
        )}
        {!expanded && selectedCount > 0 && (
          <span className="text-xs text-info-500">{selectedCount} selected</span>
        )}
      </div>
      {review.body && (
        <div className="text-sm text-stone-600 dark:text-stone-400 mt-1 ml-6 whitespace-pre-wrap">
          {review.body}
        </div>
      )}
      {expanded && hasComments && (
        <div className="ml-6 mt-2 border-l-2 border-stone-200 dark:border-stone-700 pl-3 space-y-3">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedCommentIds?.has(comment.id) ?? false}
              onToggle={() => onCommentToggle?.(comment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  selected,
  onToggle,
}: {
  comment: PrComment;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1 rounded border-stone-300 dark:border-stone-600"
      />
      <div className="flex-1 text-sm border-l-2 border-stone-200 dark:border-stone-700 pl-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-stone-700 dark:text-stone-300">{comment.author}</span>
          {comment.path && (
            <span className="text-xs text-stone-500 dark:text-stone-400 font-mono">
              {comment.path}
              {comment.line ? `:${comment.line}` : ""}
            </span>
          )}
        </div>
        <div className="text-stone-600 dark:text-stone-400 whitespace-pre-wrap">{comment.body}</div>
      </div>
    </div>
  );
}
