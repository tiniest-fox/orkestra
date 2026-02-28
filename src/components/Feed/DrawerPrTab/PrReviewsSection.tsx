//! Reviews and comments section with checkboxes for selecting comments to address.

import type { PrComment, PrReview } from "../../../types/workflow";

const REVIEW_STATE_CLASSES: Record<string, string> = {
  APPROVED: "text-status-success",
  CHANGES_REQUESTED: "text-status-error",
  COMMENTED: "text-text-tertiary",
  PENDING: "text-text-quaternary",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  PENDING: "pending",
};

interface PrReviewsSectionProps {
  reviewsWithComments: Array<{ review: PrReview; comments: PrComment[] }>;
  standaloneComments: PrComment[];
  allComments: PrComment[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  suppressed: boolean;
}

export function PrReviewsSection({
  reviewsWithComments,
  standaloneComments,
  allComments,
  selectedIds,
  onToggle,
  suppressed,
}: PrReviewsSectionProps) {
  const selectionCount = selectedIds.size;

  return (
    <div style={suppressed ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-text-quaternary">
          Reviews
        </span>
        {suppressed && (
          <span className="font-mono text-[10px] text-status-warning">resolve conflicts first</span>
        )}
      </div>

      {!suppressed && selectionCount > 0 && (
        <div className="mx-6 mb-3 px-3 py-2 rounded bg-canvas border border-border font-mono text-[10px] text-text-secondary">
          {selectionCount} of {allComments.length} comment{allComments.length !== 1 ? "s" : ""}{" "}
          selected to address
        </div>
      )}

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
    </div>
  );
}

function ReviewHeader({ review }: { review: PrReview }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-mono text-[11px] font-medium text-text-secondary">{review.author}</span>
      <span
        className={`font-mono text-[10px] ${REVIEW_STATE_CLASSES[review.state] ?? "text-text-quaternary"}`}
      >
        {REVIEW_STATE_LABELS[review.state] ?? review.state.toLowerCase()}
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
      className={`flex gap-3 py-2.5 px-3 rounded-lg mb-1.5 border cursor-pointer transition-all ${
        selected ? "bg-canvas border-border" : "border-transparent"
      } ${dimmed ? "opacity-45" : "opacity-100"}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(comment.id)}
        disabled={suppressed}
        className="mt-0.5 shrink-0 accent-status-success"
      />
      <div className="min-w-0 flex-1">
        {comment.path && (
          <div className="font-mono text-[10px] text-text-quaternary mb-1 truncate">
            {comment.path}
            {comment.line != null ? `:${comment.line}` : ""}
          </div>
        )}
        <p className="font-sans text-[12px] text-text-secondary leading-relaxed break-words">
          {comment.body}
        </p>
        <div className="font-mono text-[10px] text-text-quaternary mt-1">{comment.author}</div>
      </div>
    </label>
  );
}
