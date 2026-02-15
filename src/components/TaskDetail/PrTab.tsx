/**
 * PR tab - displays pull request status, checks, and reviews.
 */

import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { usePrStatus } from "../../providers";
import type { PrCheck, PrComment, PrReview } from "../../types/workflow";
import { Badge, CollapsibleSection, FlexContainer, Link, Panel } from "../ui";

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

  return (
    <FlexContainer direction="vertical" padded={true} gap={12} scrolls={true}>
      {/* Header with state badge and link */}
      <Panel accent={stateToAccent(status?.state)} autoFill={false} padded={true}>
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
        <CollapsibleSection title="Checks" count={status.checks.length}>
          <Panel autoFill={false} padded={true}>
            <div className="space-y-1">
              {status.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Reviews section */}
      {status?.reviews && status.reviews.length > 0 && (
        <CollapsibleSection title="Reviews" count={status.reviews.length}>
          <Panel autoFill={false} padded={true}>
            <div className="space-y-1">
              {status.reviews.map((review) => (
                <ReviewRow key={review.author} review={review} />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Comments section */}
      {status?.comments && status.comments.length > 0 && (
        <CollapsibleSection title="Comments" count={status.comments.length}>
          <Panel autoFill={false} padded={true}>
            <div className="space-y-3">
              {status.comments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  selected={selectedCommentIds?.has(comment.id) ?? false}
                  onToggle={() => {
                    const newSet = new Set(selectedCommentIds);
                    if (newSet.has(comment.id)) {
                      newSet.delete(comment.id);
                    } else {
                      newSet.add(comment.id);
                    }
                    onSelectionChange?.(newSet);
                  }}
                />
              ))}
            </div>
          </Panel>
        </CollapsibleSection>
      )}

      {/* Guidance section */}
      {status?.comments && status.comments.length > 0 && (
        <Panel autoFill={false} padded={true}>
          <h4 className="text-sm font-medium mb-2 text-stone-700 dark:text-stone-300">
            Guidance (optional)
          </h4>
          <textarea
            value={guidance ?? ""}
            onChange={(e) => onGuidanceChange?.(e.target.value)}
            placeholder="Add any additional context or instructions..."
            className="w-full h-20 text-sm rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 p-2 resize-none"
          />
        </Panel>
      )}

      {/* Empty state for no checks/reviews/comments */}
      {status &&
        status.checks.length === 0 &&
        status.reviews.length === 0 &&
        (status.comments?.length ?? 0) === 0 && (
          <div className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
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

function ReviewRow({ review }: { review: PrReview }) {
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
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="font-medium text-stone-700 dark:text-stone-300">{review.author}</span>
      <span className="text-stone-500 dark:text-stone-400">{stateLabel}</span>
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
